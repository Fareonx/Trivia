// DOM UI: lobby, HUD, question window, toasts. All player-facing text is here.
import { TEAM_COLORS } from './assets.js';

export const TEXT = {
  errors: {
    not_adjacent: 'Yalnız öz ərazinizə qonşu xananı tuta bilərsiniz',
    own_cell: 'Bu xana artıq sizindir',
    knight_busy: 'Cəngavər hələ məşğuldur',
    locked: 'Bu xana sizin üçün hələ bağlıdır',
    cell_busy: 'Bu xanada artıq döyüş gedir',
    no_path: 'Ora öz ərazinizdən yol yoxdur',
    no_cell: 'Bu xana mövcud deyil',
    no_resources: 'Resurs çatışmır',
    max_level: 'Ratuşa maksimum səviyyədədir',
    game_running: 'Bu otaqda oyun artıq gedir',
    room_full: 'Otaq doludur (maks. 4 oyunçu)',
    not_enough_players: 'Ən azı 2 oyunçu lazımdır',
    not_host: 'Oyunu yalnız otağın sahibi başlada bilər',
    not_alive: 'Siz artıq müşahidəçisiniz',
    game_over: 'Oyun bitib',
    no_bot: 'Bot tapılmadı',
    knight_dead: 'Cəngavəriniz həlak olub — Ratuşada qayıtmasını gözləyin',
    wrong_mode: 'Oyunu yalnız "Ərazi" rejimində bitirmək olar',
    bad_mode: 'Naməlum oyun rejimi',
    no_categories: 'Ən azı bir kateqoriya seçin',
  },
  killed: 'Cəngavəriniz mühasirədə həlak oldu — 10 saniyə sonra Ratuşada qayıdacaq',
  respawned: 'Cəngavəriniz Ratuşada yenidən hazırdır',
  retreated: 'Dayandığınız xana alındı — cəngavər geri çəkildi',
  modes: {
    capital: 'Bütün rəqib Ratuşalarını alan qalib gəlir.',
    territory: 'Boş xana qalmayanda və ya otaq sahibi oyunu bitirəndə ən çox xanası olan qalib gəlir. Ratuşanı almaq da olar.',
  },
  reasons: {
    capitals: 'Bütün rəqib Ratuşaları alındı.',
    board_full: 'Boş xana qalmadı.',
    host_stopped: 'Otaq sahibi oyunu bitirdi.',
  },
  correct: 'Düzgün! ✔',
  wrong: 'Səhv cavab. Xana 1 dəqiqəlik sizin üçün bağlandı',
  timedOut: 'Vaxt bitdi. Xana 1 dəqiqəlik sizin üçün bağlandı',
  duelWrong: 'Dueldə uduzdunuz — cəngavər Ratuşaya qayıtdı',
};

const $ = (id) => document.getElementById(id);

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export function errorText(code) {
  return TEXT.errors[code] ?? code;
}

function dot(color) {
  const span = document.createElement('span');
  span.className = 'dot';
  span.style.background = TEAM_COLORS[color]?.css ?? '#888';
  return span;
}

export const BOT_LEVEL_NAMES = { easy: 'Asan', medium: 'Orta', hard: 'Çətin' };

// Question categories as sent by the server: [{ id, name, icon }].
let categoryList = [];
export function setCategories(list) {
  categoryList = list ?? [];
}
export function categoryInfo(id) {
  return categoryList.find((c) => c.id === id) ?? { id, name: id, icon: '❓' };
}

function renderSettings(lobby, editable, onSettings) {
  const { mode, categories } = lobby.settings;
  $('settings-panel').disabled = !editable;
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === mode;
    radio.onchange = () => onSettings({ mode: radio.value, categories });
  }
  $('mode-hint').textContent = TEXT.modes[mode];
  const chips = $('category-chips');
  chips.replaceChildren();
  for (const c of lobby.categories) {
    const on = categories.includes(c.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${c.icon} ${c.name}`;
    chip.setAttribute('aria-pressed', String(on));
    chip.addEventListener('click', () => {
      const next = on ? categories.filter((id) => id !== c.id) : [...categories, c.id];
      if (next.length) onSettings({ mode, categories: next });
      else toast(TEXT.errors.no_categories, 'bad');
    });
    chips.appendChild(chip);
  }
}

export function renderLobby(lobby, you, { onRemoveBot, onSettings }) {
  $('join-form').hidden = true;
  $('room-panel').hidden = false;
  $('room-code').textContent = lobby.code;
  const list = $('members');
  list.replaceChildren();
  const colors = Object.keys(TEAM_COLORS);
  const isHost = lobby.hostId === you;
  lobby.members.forEach((m, i) => {
    const li = document.createElement('li');
    const label = m.isBot ? `🤖 ${m.name} (${BOT_LEVEL_NAMES[m.level]})`
      : `${m.name}${m.id === lobby.hostId ? ' 👑' : ''}${m.id === you ? ' (siz)' : ''}${m.online ? '' : ' — offline'}`;
    li.append(dot(colors[i]), label);
    if (m.isBot && isHost && !lobby.inGame) {
      const remove = document.createElement('button');
      remove.className = 'icon-btn';
      remove.title = 'Botu çıxar';
      remove.textContent = '✕';
      remove.addEventListener('click', () => onRemoveBot(m.id));
      li.appendChild(remove);
    }
    list.appendChild(li);
  });
  renderSettings(lobby, isHost && !lobby.inGame, onSettings);
  $('bot-controls').hidden = !isHost || lobby.inGame;
  $('add-bot-btn').disabled = lobby.members.length >= 4;
  $('start-btn').hidden = !isHost;
  $('start-btn').disabled = lobby.members.length < 2 || lobby.inGame;
  $('lobby-hint').textContent = lobby.inGame ? 'Oyun gedir…'
    : lobby.members.length < 2 ? 'Ən azı 2 oyunçu lazımdır: dostunuza otaq kodunu göndərin və ya bot əlavə edin.'
      : isHost ? 'Hazırsınızsa, oyunu başladın.' : 'Otağın sahibi oyunu başladacaq.';
}

export function renderHud(state, { isHost }) {
  const me = state.players.find((p) => p.id === state.you);
  const territory = state.mode === 'territory';
  $('territory-row').hidden = !territory;
  if (territory) {
    $('neutral-count').textContent = `Boş xana: ${state.cells.filter((c) => !c.owner).length}`;
    $('stop-btn').hidden = !isHost || state.phase !== 'playing';
  }
  $('gold').textContent = me.gold;
  $('wood').textContent = me.wood;
  $('hall-level').textContent = `Ratuşa: ${'★'.repeat(me.townHallLevel)}`;
  const next = state.config.townHallLevels[me.townHallLevel + 1];
  const btn = $('upgrade-btn');
  if (!me.alive) {
    btn.hidden = true;
  } else if (next) {
    btn.hidden = false;
    btn.textContent = `Gücləndir: ${next.cost.gold} qızıl + ${next.cost.wood} taxta`;
    btn.disabled = me.gold < next.cost.gold || me.wood < next.cost.wood;
  } else {
    btn.hidden = false;
    btn.textContent = 'Maksimum səviyyə';
    btn.disabled = true;
  }

  const counts = {};
  for (const c of state.cells) if (c.owner) counts[c.owner] = (counts[c.owner] ?? 0) + 1;
  const list = $('players');
  list.replaceChildren();
  for (const p of state.players) {
    const li = document.createElement('li');
    if (!p.alive) li.className = 'dead';
    li.append(dot(p.color), `${p.name}${p.id === state.you ? ' (siz)' : ''} — ${p.alive ? `${counts[p.id] ?? 0} xana` : 'məğlub'}`);
    list.appendChild(li);
  }

  const k = me.knight;
  $('status').textContent = !me.alive ? '👻 Ratuşanız alındı — indi müşahidəçisiniz'
    : k.state === 'respawning' ? '💀 Cəngavər həlak olub — tezliklə Ratuşada qayıdacaq'
    : k.state === 'moving' ? 'Cəngavər yoldadır…'
      : k.state === 'arrived' ? 'Rəqib gözlənilir — duel olacaq!'
        : k.state === 'answering' ? 'Suala cavab verin!'
          : 'Ərazinizə qonşu xananı seçin (kəsik xətlə göstərilib)';
}

/** Question window. `onAnswer(index)` sends the choice; the correct option is never known here. */
export class QuestionWindow {
  constructor(serverNow, onAnswer) {
    this.serverNow = serverNow;
    this.onAnswer = onAnswer;
    this.current = null;
    this.hideTimer = null;
    const tick = () => {
      this.updateTimer();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  show(q, playerNames) {
    clearTimeout(this.hideTimer);
    this.current = { ...q, start: this.serverNow(), answered: false };
    const category = categoryInfo(q.category);
    const meta = [`${category.icon} ${category.name}`, `Çətinlik: ${'●'.repeat(q.difficulty)}${'○'.repeat(5 - q.difficulty)}`];
    if (q.duel) meta.push(`⚔ Duel: ${q.opponents.map((id) => playerNames.get(id)).join(', ') || '—'}`);
    if (q.round > 1) meta.push(`Sual ${q.round}`);
    if (q.required > 1) meta.push(`Ratuşa: ${q.correctSoFar}/${q.required} düz cavab`);
    $('q-meta').replaceChildren(...meta.map((m) => Object.assign(document.createElement('span'), { textContent: m })));
    $('q-text').textContent = q.text;
    $('q-footer').textContent = q.round > 1 && q.duel ? 'Hər ikiniz düz cavab verdiniz — növbəti sual!' : '';
    const opts = $('q-options');
    opts.replaceChildren();
    q.options.forEach((text, i) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => this.choose(i, b));
      opts.appendChild(b);
    });
    $('question').hidden = false;
  }

  choose(index, button) {
    if (!this.current || this.current.answered) return;
    this.current.answered = true;
    this.current.chosen = button;
    button.classList.add('chosen');
    [...$('q-options').children].forEach((b) => { b.disabled = true; });
    if (this.current.duel) $('q-footer').textContent = 'Cavab göndərildi. Rəqib gözlənilir…';
    this.onAnswer(index);
  }

  result({ correct }) {
    if (!this.current) return;
    this.current.chosen?.classList.add(correct ? 'right' : 'wrong');
    [...$('q-options').children].forEach((b) => { b.disabled = true; });
    this.current = null;
    this.hideTimer = setTimeout(() => this.hide(), 1200);
  }

  hide() {
    this.current = null;
    $('question').hidden = true;
  }

  updateTimer() {
    const q = this.current;
    if (!q) return;
    const left = Math.max(0, q.deadline - this.serverNow());
    const total = Math.max(1, q.deadline - q.start);
    $('q-timer-bar').style.width = `${(left / total) * 100}%`;
    $('q-timer-bar').style.background = left < 10000 ? 'var(--bad)' : 'var(--accent)';
    $('q-timer-bar').classList.toggle('urgent', left < 10000);
  }
}

/** standings: [{ name, cells, winner }] to list, or null to hide the table. */
export function showEnd(title, text, buttonText, onClose, standings = null) {
  $('end-title').textContent = title;
  $('end-text').textContent = text;
  const list = $('end-standings');
  list.hidden = !standings;
  list.replaceChildren(...(standings ?? []).map((s) => {
    const li = document.createElement('li');
    li.textContent = `${s.name} — ${s.cells} xana`;
    if (s.winner) li.className = 'winner';
    return li;
  }));
  $('end-btn').textContent = buttonText;
  $('end-btn').onclick = () => {
    $('end').hidden = true;
    onClose();
  };
  $('end').hidden = false;
}
