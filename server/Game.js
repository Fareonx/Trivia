import { CONFIG, PLAYER_COLORS, answerMsForDifficulty } from './config.js';
import { generateMap } from './mapgen.js';
import { neighborKeys, findPath } from '../shared/hex.js';

/**
 * Authoritative game state for one match. Time is always passed in (`now`, ms)
 * so the rules can be driven deterministically from tests.
 *
 * Knight states: idle → moving → arrived (waiting for a rival) → answering → idle.
 * An "engagement" is everything happening on one target hex: a solo question
 * or a duel. While a knight has arrived at a hex, that hex is busy for everyone else.
 */
export class Game {
  constructor({ players, questionBank, seed = Date.now(), now = Date.now(), map = null }) {
    this.bank = questionBank;
    this.map = map ?? generateMap(players.length, seed);
    this.phase = 'playing';
    this.winner = null;
    this.events = [];
    this.lastIncome = now;

    this.cells = new Map();
    for (const [k, c] of this.map.cells) {
      this.cells.set(k, {
        ...c,
        key: k,
        owner: null,
        townHallOf: null,
        ruin: false,
        questionId: this.bank.draw(c.difficulty),
      });
    }

    this.players = new Map();
    players.forEach((p, i) => {
      const home = this.map.spawns[i];
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        color: PLAYER_COLORS[i],
        alive: true,
        gold: 0,
        wood: 0,
        townHall: home,
        townHallLevel: 1,
        knight: { at: home, state: 'idle', path: null, moveStart: 0, stepIndex: 0, target: null, from: null },
      });
      const hall = this.cells.get(home);
      hall.owner = p.id;
      hall.townHallOf = p.id;
      for (const n of neighborKeys(home)) {
        const cell = this.cells.get(n);
        if (cell) cell.owner = p.id;
      }
    });

    // Per-player locks: Map<playerId, Map<cellKey, untilMs>>.
    this.locks = new Map([...this.players.keys()].map((id) => [id, new Map()]));
    // Map<cellKey, engagement>.
    this.engagements = new Map();
  }

  // ---------------------------------------------------------------- queries

  isLocked(playerId, cellKey, now) {
    const until = this.locks.get(playerId)?.get(cellKey);
    return until !== undefined && until > now;
  }

  isAdjacentToTerritory(playerId, cellKey) {
    return neighborKeys(cellKey).some((n) => this.cells.get(n)?.owner === playerId);
  }

  knightsHeadingTo(cellKey, exceptId = null) {
    return [...this.players.values()].filter(
      (p) => p.alive && p.id !== exceptId && p.knight.state === 'moving' && p.knight.target === cellKey,
    );
  }

  // ---------------------------------------------------------------- actions

  moveKnight(playerId, targetKey, now) {
    const player = this.players.get(playerId);
    if (this.phase !== 'playing') return fail('game_over');
    if (!player || !player.alive) return fail('not_alive');
    const knight = player.knight;
    if (knight.state !== 'idle') return fail('knight_busy');
    const cell = this.cells.get(targetKey);
    if (!cell) return fail('no_cell');
    if (cell.owner === playerId) return fail('own_cell');
    if (!this.isAdjacentToTerritory(playerId, targetKey)) return fail('not_adjacent');
    if (this.isLocked(playerId, targetKey, now)) return fail('locked');
    if (this.engagements.has(targetKey)) return fail('cell_busy');
    if (this.knightsHeadingTo(targetKey, playerId).length >= 2) return fail('cell_busy');

    const path = findPath(knight.at, targetKey, (k) => this.cells.get(k)?.owner === playerId);
    if (!path) return fail('no_path');

    Object.assign(knight, { state: 'moving', path, moveStart: now, stepIndex: 0, target: targetKey, from: null });
    this.emit(null, 'knightMoved', { playerId, path, moveStart: now });
    return { ok: true, path, arriveAt: now + (path.length - 1) * CONFIG.MOVE_MS_PER_HEX };
  }

  submitAnswer(playerId, optionIndex, now) {
    this.update(now);
    const player = this.players.get(playerId);
    if (!player || player.knight.state !== 'answering') return fail('not_answering');
    const eng = this.engagements.get(player.knight.target);
    if (!eng || eng.phase !== 'question' || !eng.active.includes(playerId)) return fail('not_answering');
    if (eng.answers.has(playerId)) return fail('already_answered');
    eng.answers.set(playerId, optionIndex);
    this.emit(null, 'answerSubmitted', { target: eng.target, playerId });
    if (eng.active.every((id) => eng.answers.has(id))) this.resolveRound(eng, now);
    return { ok: true };
  }

  upgradeTownHall(playerId) {
    const player = this.players.get(playerId);
    if (this.phase !== 'playing') return fail('game_over');
    if (!player || !player.alive) return fail('not_alive');
    const next = CONFIG.TOWN_HALL_LEVELS[player.townHallLevel + 1];
    if (!next) return fail('max_level');
    if (player.gold < next.cost.gold || player.wood < next.cost.wood) return fail('no_resources');
    player.gold -= next.cost.gold;
    player.wood -= next.cost.wood;
    player.townHallLevel++;
    this.emit(null, 'townHallUpgraded', { playerId, level: player.townHallLevel, key: player.townHall });
    return { ok: true, level: player.townHallLevel };
  }

  // Player left the match: treat like losing their capital to nobody.
  removePlayer(playerId, now) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    this.eliminate(player, null, now);
    this.checkWinner();
  }

  // ---------------------------------------------------------------- simulation

  update(now) {
    if (this.phase !== 'playing') return;
    this.advanceKnights(now);

    for (const eng of [...this.engagements.values()]) {
      if (eng.phase === 'waiting' && now >= eng.waitUntil) this.stopLateRivals(eng, eng.waitUntil);
      else if (eng.phase === 'question' && now >= eng.deadline) this.resolveRound(eng, eng.deadline);
    }

    while (now - this.lastIncome >= CONFIG.RESOURCE_INTERVAL_MS) {
      this.lastIncome += CONFIG.RESOURCE_INTERVAL_MS;
      this.payIncome();
    }

    for (const map of this.locks.values()) {
      for (const [k, until] of map) if (until <= now) map.delete(k);
    }
  }

  advanceKnights(now) {
    const arrivals = [];
    for (const player of this.players.values()) {
      const knight = player.knight;
      if (!player.alive || knight.state !== 'moving') continue;
      const last = knight.path.length - 1;
      const reached = Math.min(last, Math.floor((now - knight.moveStart) / CONFIG.MOVE_MS_PER_HEX));
      for (let i = knight.stepIndex + 1; i <= reached; i++) {
        const k = knight.path[i];
        // Intermediate hexes must still be ours; otherwise stop on the last safe one.
        if (i < last && this.cells.get(k)?.owner !== player.id) {
          this.stopKnight(player, knight.moveStart + i * CONFIG.MOVE_MS_PER_HEX);
          break;
        }
        knight.stepIndex = i;
        knight.at = k;
      }
      if (knight.state === 'moving' && knight.stepIndex === last) {
        arrivals.push({ player, time: knight.moveStart + last * CONFIG.MOVE_MS_PER_HEX });
      }
    }
    arrivals.sort((a, b) => a.time - b.time);
    for (const { player, time } of arrivals) this.arrive(player, time);
  }

  arrive(player, time) {
    const knight = player.knight;
    const target = knight.target;
    knight.state = 'arrived';
    knight.from = knight.path.length > 1 ? knight.path[knight.path.length - 2] : knight.path[0];
    knight.path = null;

    let eng = this.engagements.get(target);
    if (eng && !eng.participants.includes(player.id)) {
      // Someone else's question is already running here; step back.
      knight.at = knight.from;
      Object.assign(knight, { state: 'idle', target: null, from: null, stepIndex: 0 });
      this.emit(null, 'knightStopped', { playerId: player.id, at: knight.at });
      return;
    }
    if (eng) {
      // A rival was already waiting here for us — the duel can start.
      eng.arrived.add(player.id);
    } else {
      const rivals = this.knightsHeadingTo(target, player.id).slice(0, 1);
      eng = {
        target,
        phase: 'waiting',
        participants: [player.id, ...rivals.map((r) => r.id)],
        arrived: new Set([player.id]),
        waitUntil: time + CONFIG.DUEL_WAIT_MS,
        active: [],
        answers: new Map(),
        correct: new Map(),
        round: 0,
        duel: false,
        question: null,
        deadline: 0,
      };
      this.engagements.set(target, eng);
    }
    this.emit(null, 'knightArrived', { playerId: player.id, target });
    if (eng.participants.every((id) => eng.arrived.has(id))) this.startEngagement(eng, time);
  }

  // The waiting knight's patience ran out: rivals still walking stop where they are.
  stopLateRivals(eng, time) {
    for (const id of eng.participants) {
      if (!eng.arrived.has(id)) this.stopKnight(this.players.get(id), time);
    }
    eng.participants = eng.participants.filter((id) => eng.arrived.has(id));
    this.startEngagement(eng, time);
  }

  startEngagement(eng, time) {
    eng.duel = eng.participants.length > 1;
    eng.active = [...eng.participants];
    eng.participants.forEach((id) => {
      eng.correct.set(id, 0);
      this.players.get(id).knight.state = 'answering';
    });
    this.startRound(eng, time);
  }

  startRound(eng, time) {
    const cell = this.cells.get(eng.target);
    eng.round++;
    eng.phase = 'question';
    eng.answers = new Map();
    // The first question is the hex's own; follow-ups (duel rounds, level-3 halls) are fresh.
    const questionId = eng.round === 1 ? cell.questionId : this.bank.draw(cell.difficulty, [cell.questionId]);
    eng.question = this.bank.present(questionId);

    let answerMs = answerMsForDifficulty(cell.difficulty);
    const hall = this.townHallLevelOf(cell);
    if (hall?.answerMs) answerMs = Math.min(answerMs, hall.answerMs);
    eng.deadline = time + answerMs;

    for (const id of eng.active) {
      this.emit(id, 'question', {
        target: eng.target,
        difficulty: cell.difficulty,
        text: eng.question.text,
        options: eng.question.options,
        deadline: eng.deadline,
        round: eng.round,
        duel: eng.duel,
        opponents: eng.active.filter((o) => o !== id),
        required: this.requiredCorrect(cell),
        correctSoFar: eng.correct.get(id),
      });
    }
    this.emit(null, 'engagementStarted', { target: eng.target, participants: eng.active, deadline: eng.deadline, round: eng.round });
  }

  townHallLevelOf(cell) {
    if (!cell.townHallOf) return null;
    const owner = this.players.get(cell.townHallOf);
    return owner?.alive ? CONFIG.TOWN_HALL_LEVELS[owner.townHallLevel] : null;
  }

  requiredCorrect(cell) {
    return this.townHallLevelOf(cell)?.questions ?? 1;
  }

  resolveRound(eng, time) {
    const cell = this.cells.get(eng.target);
    const winners = [];
    const losers = [];
    for (const id of eng.active) {
      const ok = eng.answers.get(id) === eng.question.correctIndex;
      if (ok) {
        winners.push(id);
        eng.correct.set(id, eng.correct.get(id) + 1);
      } else {
        losers.push(id);
      }
      // Only right/wrong is revealed — never which option was correct.
      this.emit(id, 'answerResult', { target: eng.target, correct: ok, timedOut: !eng.answers.has(id), duel: eng.duel });
    }

    for (const id of losers) this.loseEngagement(this.players.get(id), eng, time);
    eng.active = winners;

    if (winners.length === 0) {
      this.engagements.delete(eng.target);
      this.emit(null, 'engagementEnded', { target: eng.target, winner: null });
      return;
    }
    if (winners.length === 1 && eng.correct.get(winners[0]) >= this.requiredCorrect(cell)) {
      this.engagements.delete(eng.target);
      this.capture(this.players.get(winners[0]), cell, time);
      this.emit(null, 'engagementEnded', { target: eng.target, winner: winners[0] });
      return;
    }
    // Duel still tied, or a level-3 Town Hall needs another correct answer.
    this.startRound(eng, time);
  }

  loseEngagement(player, eng, time) {
    const knight = player.knight;
    this.locks.get(player.id).set(eng.target, time + CONFIG.LOCK_MS);
    // Solo failure: step back to the hex we came from. Duel loss: back to the Town Hall.
    knight.at = eng.duel ? player.townHall : knight.from;
    Object.assign(knight, { state: 'idle', path: null, target: null, from: null, stepIndex: 0 });
  }

  capture(player, cell, time) {
    const previousOwner = cell.owner ? this.players.get(cell.owner) : null;
    cell.owner = player.id;
    cell.questionId = this.bank.draw(cell.difficulty, [cell.questionId]);
    const knight = player.knight;
    knight.at = cell.key;
    Object.assign(knight, { state: 'idle', path: null, target: null, from: null, stepIndex: 0 });
    this.emit(null, 'cellCaptured', { key: cell.key, playerId: player.id, from: previousOwner?.id ?? null });

    if (previousOwner && cell.townHallOf === previousOwner.id) {
      this.eliminate(previousOwner, player, time);
      this.checkWinner();
    }
  }

  eliminate(loser, conqueror, time) {
    for (const cell of this.cells.values()) {
      if (cell.owner === loser.id) cell.owner = conqueror ? conqueror.id : null;
      if (cell.townHallOf === loser.id) {
        cell.townHallOf = null;
        cell.ruin = true;
      }
    }
    if (conqueror) {
      conqueror.gold += loser.gold;
      conqueror.wood += loser.wood;
    }
    loser.gold = 0;
    loser.wood = 0;
    loser.alive = false;
    const target = loser.knight.target;
    Object.assign(loser.knight, { state: 'dead', path: null, target: null });

    // Pull the loser out of any engagement they were part of.
    const eng = target && this.engagements.get(target);
    if (eng) {
      eng.participants = eng.participants.filter((id) => id !== loser.id);
      eng.active = eng.active.filter((id) => id !== loser.id);
      if (!eng.participants.length) this.engagements.delete(target);
      else if (eng.phase === 'waiting' && eng.participants.every((id) => eng.arrived.has(id))) {
        this.startEngagement(eng, time);
      } else if (eng.phase === 'question' && eng.active.length && eng.active.every((id) => eng.answers.has(id))) {
        this.resolveRound(eng, time);
      }
    }
    this.emit(null, 'playerEliminated', { playerId: loser.id, by: conqueror?.id ?? null });
  }

  checkWinner() {
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length <= 1) {
      this.phase = 'over';
      this.winner = alive[0]?.id ?? null;
      this.emit(null, 'gameOver', { winner: this.winner });
    }
  }

  stopKnight(player, time) {
    const knight = player.knight;
    const target = knight.target;
    Object.assign(knight, { state: 'idle', path: null, target: null, from: null, stepIndex: 0 });
    const eng = target && this.engagements.get(target);
    if (eng && eng.phase === 'waiting') {
      eng.participants = eng.participants.filter((id) => id !== player.id);
    }
    this.emit(null, 'knightStopped', { playerId: player.id, at: knight.at });
    // A rival waiting for this knight no longer needs to wait.
    if (eng && eng.phase === 'waiting' && eng.participants.length && eng.participants.every((id) => eng.arrived.has(id))) {
      this.startEngagement(eng, time);
    }
  }

  payIncome() {
    for (const cell of this.cells.values()) {
      if (!cell.resource || !cell.owner) continue;
      const owner = this.players.get(cell.owner);
      if (owner?.alive) owner[cell.resource] += CONFIG.RESOURCE_AMOUNT;
    }
  }

  // ---------------------------------------------------------------- output

  emit(to, type, data) {
    this.events.push({ to, type, data });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Public snapshot. Locks are private to each player; correct answers never leave the server.
  snapshotFor(playerId, now) {
    return {
      now,
      phase: this.phase,
      winner: this.winner,
      you: playerId,
      config: {
        moveMsPerHex: CONFIG.MOVE_MS_PER_HEX,
        townHallLevels: CONFIG.TOWN_HALL_LEVELS,
      },
      cells: [...this.cells.values()].map((c) => ({
        key: c.key, q: c.q, r: c.r, difficulty: c.difficulty, resource: c.resource, owner: c.owner,
        townHallOf: c.townHallOf, ruin: c.ruin,
      })),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        alive: p.alive,
        gold: p.gold,
        wood: p.wood,
        townHall: p.townHall,
        townHallLevel: p.townHallLevel,
        knight: { at: p.knight.at, state: p.knight.state, path: p.knight.path, moveStart: p.knight.moveStart, target: p.knight.target },
      })),
      engagements: [...this.engagements.values()].map((e) => ({
        target: e.target, phase: e.phase, participants: e.participants, duel: e.duel,
        deadline: e.phase === 'question' ? e.deadline : e.waitUntil, round: e.round,
      })),
      locks: Object.fromEntries(this.locks.get(playerId) ?? []),
    };
  }
}

function fail(error) {
  return { ok: false, error };
}
