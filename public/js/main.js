import { connect } from './net.js';
import { loadAssets } from './assets.js';
import { GameView } from './game.js';
import { TEXT, toast, errorText, renderLobby, renderHud, QuestionWindow, showEnd } from './ui.js';
import { play, isMuted, setMuted } from './sound.js';

const $ = (id) => document.getElementById(id);
const net = connect();
const assetsReady = loadAssets();

let you = null;
let view = null;
let lastPhase = null;
const names = new Map();

const questionWindow = new QuestionWindow(net.serverNow, async (index) => {
  const res = await net.call('answer', { index });
  if (!res.ok) toast(errorText(res.error), 'bad');
});

function showScreen(name) {
  $('lobby').hidden = name !== 'lobby';
  $('game').hidden = name !== 'game';
}

async function join(name, room) {
  const res = await net.call('join', { name, room, token: net.token });
  if (!res.ok) {
    toast(errorText(res.error), 'bad');
    return false;
  }
  you = res.you;
  localStorage.setItem('zd_name', name);
  return true;
}

async function callOrToast(event, payload) {
  const res = await net.call(event, payload);
  if (!res.ok) toast(errorText(res.error), 'bad');
  return res.ok;
}

$('name').value = localStorage.getItem('zd_name') ?? '';
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

// After a page refresh sessionStorage still has our seat — rejoin silently.
net.socket.on('connect', () => {
  const name = localStorage.getItem('zd_name');
  const room = sessionStorage.getItem('zd_room');
  if (you === null && name && room) join(name, room);
});

net.socket.on('lobby', (lobby) => {
  sessionStorage.setItem('zd_room', lobby.code);
  renderLobby(lobby, you, { onRemoveBot: (id) => callOrToast('removeBot', { id }) });
});

net.socket.on('state', async (s) => {
  const assets = await assetsReady;
  s.players.forEach((p) => names.set(p.id, p.name));
  if (!view) {
    view = new GameView($('map'), {
      assets,
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
  renderHud(s);
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
    case 'gameOver':
      if (data.winner === you) play('victory');
      questionWindow.hide();
      showEnd(data.winner === you ? '🏆 Qələbə!' : 'Oyun bitdi',
        data.winner ? `Qalib: ${names.get(data.winner)}` : 'Qalib yoxdur',
        'Lobbiyə qayıt', () => showScreen('lobby'));
      break;
    default:
      break;
  }
});
