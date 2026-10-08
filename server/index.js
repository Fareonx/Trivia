import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { CONFIG } from './config.js';
import { Game } from './Game.js';
import { Bot } from './Bot.js';
import { QuestionBank, loadQuestions } from './questions.js';

const PORT = Number(process.env.PORT) || 3000;
// A player who drops out of a running match has this long to come back.
const RECONNECT_GRACE_MS = 60000;

const root = (p) => fileURLToPath(new URL(p, import.meta.url));
const app = express();
app.use(express.static(root('../public')));
app.use('/shared', express.static(root('../shared')));
app.get('/healthz', (_req, res) => res.send('ok'));

const httpServer = createServer(app);
const io = new Server(httpServer);
const questions = loadQuestions();

/**
 * code → { code, hostId, members, game, timer, bots }
 * members: Map<playerId, {id, name, socketId, dropTimer, isBot, level}>
 */
const rooms = new Map();

const humans = (room) => [...room.members.values()].filter((m) => !m.isBot);

function closeRoom(room) {
  clearInterval(room.timer);
  for (const m of room.members.values()) clearTimeout(m.dropTimer);
  rooms.delete(room.code);
}

function lobbyState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    inGame: Boolean(room.game && room.game.phase === 'playing'),
    members: [...room.members.values()].map((m) => ({
      id: m.id, name: m.name, isBot: Boolean(m.isBot), level: m.level ?? null, online: Boolean(m.isBot || m.socketId),
    })),
  };
}

function sendLobby(room) {
  io.to(room.code).emit('lobby', lobbyState(room));
}

function sendState(room) {
  if (!room.game) return;
  const now = Date.now();
  for (const m of room.members.values()) {
    if (m.socketId) io.to(m.socketId).emit('state', room.game.snapshotFor(m.id, now));
  }
}

function flush(room) {
  const game = room.game;
  if (!game) return;
  const events = game.drainEvents();
  for (const ev of events) {
    if (ev.to === null) {
      io.to(room.code).emit('event', { type: ev.type, data: ev.data });
    } else {
      const m = room.members.get(ev.to);
      if (m?.socketId) io.to(m.socketId).emit('event', { type: ev.type, data: ev.data });
    }
  }
  if (events.length) sendState(room);
  if (game.phase === 'over' && room.timer) {
    clearInterval(room.timer);
    room.timer = null;
    sendLobby(room);
  }
}

function startGame(room) {
  const now = Date.now();
  const players = [...room.members.values()].slice(0, CONFIG.MAX_PLAYERS).map((m) => ({ id: m.id, name: m.name }));
  room.game = new Game({ players, questionBank: new QuestionBank(questions), now });
  room.bots = [...room.members.values()].filter((m) => m.isBot).map((m) => new Bot(m.id, m.level));
  let lastFullSync = now;
  room.timer = setInterval(() => {
    const t = Date.now();
    room.game.update(t);
    for (const bot of room.bots) bot.update(room.game, t);
    flush(room);
    // Periodic full sync keeps resource counters and clocks fresh.
    if (t - lastFullSync >= 1000) {
      lastFullSync = t;
      sendState(room);
    }
  }, CONFIG.TICK_MS);
  sendLobby(room);
  sendState(room);
}

function cleanName(name) {
  return String(name ?? '').trim().slice(0, 20) || 'Oyunçu';
}

function cleanCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MAIN';
}

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  socket.on('join', ({ name, room: code, token } = {}, ack = () => {}) => {
    if (room) return ack({ ok: false, error: 'already_joined' });
    code = cleanCode(code);
    playerId = String(token ?? '').slice(0, 64) || socket.id;
    room = rooms.get(code);
    if (!room) {
      room = { code, hostId: playerId, members: new Map(), game: null, timer: null, bots: [] };
      rooms.set(code, room);
    }
    const existing = room.members.get(playerId);
    if (existing) {
      // Reconnect (page refresh) — re-attach to the same seat.
      clearTimeout(existing.dropTimer);
      existing.socketId = socket.id;
    } else {
      const error = room.game?.phase === 'playing' ? 'game_running'
        : room.members.size >= CONFIG.MAX_PLAYERS ? 'room_full' : null;
      if (error) {
        room = null;
        return ack({ ok: false, error });
      }
      room.members.set(playerId, { id: playerId, name: cleanName(name), socketId: socket.id, dropTimer: null });
    }
    socket.join(code);
    ack({ ok: true, you: playerId, code });
    sendLobby(room);
    if (room.game) socket.emit('state', room.game.snapshotFor(playerId, Date.now()));
  });

  socket.on('start', (_ = {}, ack = () => {}) => {
    if (!room || room.hostId !== playerId) return ack({ ok: false, error: 'not_host' });
    if (room.game?.phase === 'playing') return ack({ ok: false, error: 'game_running' });
    if (room.members.size < CONFIG.MIN_PLAYERS) return ack({ ok: false, error: 'not_enough_players' });
    startGame(room);
    ack({ ok: true });
  });

  // Bots are managed by the host while the room is in the lobby.
  const lobbyAction = (fn) => (payload = {}, ack = () => {}) => {
    if (!room || room.hostId !== playerId) return ack({ ok: false, error: 'not_host' });
    if (room.game?.phase === 'playing') return ack({ ok: false, error: 'game_running' });
    const res = fn(payload);
    ack(res);
    if (res.ok) sendLobby(room);
  };

  socket.on('addBot', lobbyAction(({ level }) => {
    if (room.members.size >= CONFIG.MAX_PLAYERS) return { ok: false, error: 'room_full' };
    const usedNames = new Set([...room.members.values()].map((m) => m.name));
    const name = CONFIG.BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${room.members.size + 1}`;
    const id = `bot-${room.code}-${Date.now().toString(36)}-${room.members.size}`;
    const botLevel = CONFIG.BOT_LEVELS[level] ? level : 'medium';
    room.members.set(id, { id, name, socketId: null, dropTimer: null, isBot: true, level: botLevel });
    return { ok: true, id };
  }));

  socket.on('removeBot', lobbyAction(({ id }) => {
    if (!room.members.get(id)?.isBot) return { ok: false, error: 'no_bot' };
    room.members.delete(id);
    return { ok: true };
  }));

  const gameAction = (fn) => (payload = {}, ack = () => {}) => {
    if (!room?.game) return ack({ ok: false, error: 'no_game' });
    const res = fn(room.game, payload, Date.now());
    ack(res);
    flush(room);
  };

  socket.on('move', gameAction((game, { target }, now) => {
    game.update(now);
    return game.moveKnight(playerId, String(target), now);
  }));
  socket.on('answer', gameAction((game, { index }, now) => game.submitAnswer(playerId, Number(index), now)));
  socket.on('upgrade', gameAction((game) => game.upgradeTownHall(playerId)));
  socket.on('ping_time', (_ = {}, ack = () => {}) => ack(Date.now()));

  socket.on('disconnect', () => {
    if (!room) return;
    const member = room.members.get(playerId);
    if (!member || member.socketId !== socket.id) return;
    member.socketId = null;
    const r = room;
    if (r.game?.phase === 'playing' && r.game.players.has(playerId)) {
      member.dropTimer = setTimeout(() => {
        if (member.socketId) return;
        r.game.removePlayer(playerId, Date.now());
        r.members.delete(playerId);
        if (!humans(r).length) return closeRoom(r);
        flush(r);
        sendLobby(r);
      }, RECONNECT_GRACE_MS);
    } else {
      r.members.delete(playerId);
    }
    // Bots never keep a room alive or host it.
    if (!humans(r).length) return closeRoom(r);
    if (r.hostId === playerId) {
      r.hostId = (humans(r).find((m) => m.socketId) ?? humans(r)[0]).id;
    }
    sendLobby(r);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Zəka Döyüşü: http://localhost:${PORT}`);
});
