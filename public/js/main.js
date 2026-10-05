import { connect } from './net.js';
import { loadAssets } from './assets.js';
import { GameView } from './game.js';
import { TEXT, toast, errorText, renderLobby, renderHud, QuestionWindow, showEnd } from './ui.js';

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
  if (!res.ok) return toast(errorText(res.error), 'bad');
  you = res.you;
  localStorage.setItem('zd_name', name);
}

$('name').value = localStorage.getItem('zd_name') ?? '';
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join($('name').value, $('room').value);
});
$('start-btn').addEventListener('click', async () => {
  const res = await net.call('start');
  if (!res.ok) toast(errorText(res.error), 'bad');
});
$('upgrade-btn').addEventListener('click', async () => {
  const res = await net.call('upgrade');
  toast(res.ok ? `Ratuşa ${res.level}-ci səviyyəyə yüksəldi!` : errorText(res.error), res.ok ? 'ok' : 'bad');
});

// After a page refresh sessionStorage still has our seat — rejoin silently.
net.socket.on('connect', () => {
  const name = localStorage.getItem('zd_name');
  const room = sessionStorage.getItem('zd_room');
  if (you === null && name && room) join(name, room);
});

net.socket.on('lobby', (lobby) => {
  sessionStorage.setItem('zd_room', lobby.code);
  renderLobby(lobby, you);
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
      break;
    case 'answerResult': {
      questionWindow.result(data);
      if (data.correct) toast(TEXT.correct, 'ok');
      else toast(data.duel ? TEXT.duelWrong : data.timedOut ? TEXT.timedOut : TEXT.wrong, 'bad');
      break;
    }
    case 'cellCaptured':
      if (data.from === you) toast(`${names.get(data.playerId)} sizin xananızı aldı!`, 'bad');
      break;
    case 'engagementStarted':
      if (data.round === 1 && data.participants.length > 1 && data.participants.includes(you)) toast('⚔ Duel başladı!', 'ok');
      break;
    case 'playerEliminated':
      if (data.playerId === you) {
        questionWindow.hide();
        showEnd('Ratuşanız alındı', 'Bütün əraziləriniz rəqibə keçdi. Oyunu müşahidə edə bilərsiniz.', 'Müşahidə et', () => {});
      } else {
        toast(`${names.get(data.playerId)} məğlub oldu${data.by ? ` — qalib: ${names.get(data.by)}` : ''}`);
      }
      break;
    case 'gameOver':
      questionWindow.hide();
      showEnd(data.winner === you ? '🏆 Qələbə!' : 'Oyun bitdi',
        data.winner ? `Qalib: ${names.get(data.winner)}` : 'Qalib yoxdur',
        'Lobbiyə qayıt', () => showScreen('lobby'));
      break;
    default:
      break;
  }
});
