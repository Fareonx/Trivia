import { connect } from './net.js';
import { loadAssets } from './assets.js';
import { GameView } from './game.js';
import {
  TEXT, toast, errorText, renderLobby, renderHud, QuestionWindow, showEnd, setCategories, categoryInfo,
} from './ui.js';
import { play, isMuted, setMuted } from './sound.js';

const $ = (id) => document.getElementById(id);
const net = connect();
const assetsReady = loadAssets();

let you = null;
let view = null;
let lastPhase = null;
let hostId = null;
const names = new Map();

const questionWindow = new QuestionWindow(net.serverNow, async (index) => {
  const res = await net.call('answer', { index });
  if (!res.ok) toast(errorText(res.error), 'bad');
});

function showScreen(name) {
  $('lobby').hidden = name !== 'lobby';
  $('game').hidden = name !== 'game';
}

// Storage can be unavailable (private mode, blocked site data); the game still works without it.
const store = {
  get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch { /* ignore */ } },
  remove(area, k) { try { window[area].removeItem(k); } catch { /* ignore */ } },
};

// The seat we hold ({name, room}); re-joined automatically after every reconnect.
function savedSeat() {
  try { return JSON.parse(store.get('sessionStorage', 'zd_seat')); } catch { return null; }
}

async function join(name, room) {
  const res = await net.call('join', { name, room, token: net.token });
  if (!res.ok) {
    toast(errorText(res.error), 'bad');
    if (savedSeat()?.room === room) store.remove('sessionStorage', 'zd_seat');
    return false;
  }
  you = res.you;
  store.set('localStorage', 'zd_name', name);
  store.set('sessionStorage', 'zd_seat', JSON.stringify({ name, room: res.code }));
  return true;
}

async function callOrToast(event, payload) {
  const res = await net.call(event, payload);
  if (!res.ok) toast(errorText(res.error), 'bad');
  return res.ok;
}

$('name').value = store.get('localStorage', 'zd_name') ?? '';
// Invite links look like https://…/?otaq=CODE
const invited = new URLSearchParams(window.location.search).get('otaq');
if (invited) $('room').value = invited.toUpperCase();

$('invite-btn').addEventListener('click', async () => {
  const link = `${window.location.origin}/?otaq=${encodeURIComponent($('room-code').textContent)}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Dəvət linki kopyalandı — dostlarınıza göndərin', 'ok');
  } catch {
    window.prompt('Dəvət linkini kopyalayın:', link);
  }
});

// Open rooms on this server, refreshed while the join form is visible.
async function refreshRooms() {
  if ($('join-form').hidden || !net.socket.connected) return;
  const rooms = await net.call('listRooms');
  const list = $('room-list');
  list.replaceChildren(...rooms.map((r) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${r.code} — ${r.players}/${r.max} · ${r.inGame ? 'oyun gedir' : 'gözləyir'}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary';
    btn.textContent = 'Qoşul';
    btn.disabled = r.inGame || r.players >= r.max;
    btn.addEventListener('click', () => {
      const name = $('name').value.trim();
      if (!name) {
        $('name').focus();
        toast('Əvvəlcə adınızı yazın', 'bad');
        return;
      }
      $('room').value = r.code;
      join(name, r.code);
    });
    li.append(label, btn);
    return li;
  }));
  $('rooms-panel').hidden = rooms.length === 0;
}
setInterval(refreshRooms, 4000);

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join($('name').value, $('room').value);
});
// Quick solo match: private room + one medium bot, started straight away.
$('solo-btn').addEventListener('click', async () => {
  const name = $('name').value.trim() || 'Oyunçu';
  $('name').value = name;
  const code = `SOLO${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  if (!(await join(name, code))) return;
  if (await callOrToast('addBot', { level: 'medium' })) await callOrToast('start');
});
$('start-btn').addEventListener('click', () => callOrToast('start'));
$('add-bot-btn').addEventListener('click', () => callOrToast('addBot', { level: $('bot-level').value }));
const renderMute = () => { $('mute-btn').textContent = isMuted() ? '🔇' : '🔊'; };
renderMute();
$('mute-btn').addEventListener('click', () => {
  setMuted(!isMuted());
  renderMute();
});
$('upgrade-btn').addEventListener('click', async () => {
  const res = await net.call('upgrade');
  toast(res.ok ? `Ratuşa ${res.level}-ci səviyyəyə yüksəldi!` : errorText(res.error), res.ok ? 'ok' : 'bad');
  if (res.ok) play('upgrade');
});

// After every (re)connect — page refresh, network blip, server restart — take our seat back.
net.socket.on('connect', () => {
  $('offline-banner').hidden = true;
  const seat = savedSeat();
  if (seat) join(seat.name, seat.room);
  else refreshRooms();
});
net.socket.on('disconnect', () => {
  $('offline-banner').hidden = false;
});

net.socket.on('lobby', (lobby) => {
  // The server restarted while we were playing: that match is gone, back to the lobby.
  if (!lobby.inGame && lastPhase === 'playing') {
    lastPhase = null;
    questionWindow.hide();
    showScreen('lobby');
    toast('Server yenidən başladı — oyun dayandı. Yenidən başlada bilərsiniz.', 'bad');
  }
  hostId = lobby.hostId;
  setCategories(lobby.categories);
  renderLobby(lobby, you, {
    onRemoveBot: (id) => callOrToast('removeBot', { id }),
    onSettings: (settings) => callOrToast('settings', settings),
  });
});

$('stop-btn').addEventListener('click', () => {
  if (window.confirm('Oyunu bitirmək istəyirsiniz? Ən çox xanası olan qalib gələcək.')) callOrToast('stopGame');
});

net.socket.on('state', async (s) => {
  const assets = await assetsReady;
  s.players.forEach((p) => names.set(p.id, p.name));
  if (!view) {
    view = new GameView($('map'), {
      assets,
      categoryIcon: (id) => categoryInfo(id).icon,
      serverNow: net.serverNow,
      onCellClick: async (cell) => {
        const res = await net.call('move', { target: cell.key });
        if (!res.ok) toast(errorText(res.error), 'bad');
      },
      onStep: () => play('step'),
    });
  }
  if (s.phase === 'playing' && lastPhase !== 'playing') {
    view.centered = false;
    $('end').hidden = true;
    showScreen('game');
  }
  lastPhase = s.phase;
  view.setState(s);
  renderHud(s, { isHost: hostId === you });
});

net.socket.on('event', ({ type, data }) => {
  switch (type) {
    case 'question':
      questionWindow.show(data, names);
      play('question');
      break;
    case 'answerResult': {
      questionWindow.result(data);
      play(data.correct ? 'correct' : 'wrong');
      if (data.correct) toast(TEXT.correct, 'ok');
      else toast(data.duel ? TEXT.duelWrong : data.timedOut ? TEXT.timedOut : TEXT.wrong, 'bad');
      break;
    }
    case 'cellCaptured':
      view?.effect('capture', data.key, { color: view.colorOf(data.playerId) });
      if (data.from === you) {
        toast(`${names.get(data.playerId)} sizin xananızı aldı!`, 'bad');
        play('alarm');
      }
      break;
    case 'engagementEnded':
      // Nobody won: the attacker(s) answered wrong or ran out of time.
      if (!data.winner) view?.effect('fail', data.target);
      break;
    case 'knightArrived':
      view?.effect('arrive', data.target);
      break;
    case 'townHallUpgraded':
      view?.effect('upgrade', data.key);
      break;
    case 'engagementStarted':
      if (data.round === 1 && data.participants.length > 1 && data.participants.includes(you)) {
        toast('⚔ Duel başladı!', 'ok');
        play('duel');
      }
      break;
    case 'playerEliminated':
      if (data.playerId === you) {
        play('defeat');
        questionWindow.hide();
        showEnd('Ratuşanız alındı', 'Bütün əraziləriniz rəqibə keçdi. Oyunu müşahidə edə bilərsiniz.', 'Müşahidə et', () => {});
      } else {
        toast(`${names.get(data.playerId)} məğlub oldu${data.by ? ` — qalib: ${names.get(data.by)}` : ''}`);
      }
      break;
    case 'knightKilled':
      view?.effect('death', data.at);
      if (data.playerId === you) {
        toast(TEXT.killed, 'bad');
        play('death');
      }
      break;
    case 'knightRespawned':
      if (data.playerId === you) {
        toast(TEXT.respawned, 'ok');
        play('respawn');
      }
      break;
    case 'gameOver': {
      lastPhase = 'over';
      if (data.winner === you) play('victory');
      questionWindow.hide();
      const result = data.winner ? `Qalib: ${names.get(data.winner)}` : 'Heç-heçə — qalib yoxdur';
      const standings = data.standings?.map((s) => ({
        name: names.get(s.playerId), cells: s.cells, winner: s.playerId === data.winner,
      }));
      showEnd(data.winner === you ? '🏆 Qələbə!' : 'Oyun bitdi', `${TEXT.reasons[data.reason] ?? ''} ${result}`,
        'Lobbiyə qayıt', () => showScreen('lobby'), standings);
      break;
    }
    default:
      break;
  }
});
