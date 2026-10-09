import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';

const GRACE = 300;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const server = createGameServer({ lobbyGraceMs: GRACE, gameGraceMs: GRACE });
  await new Promise((r) => server.httpServer.listen(0, r));
  const url = `http://localhost:${server.httpServer.address().port}`;
  const clients = [];
  const client = () => {
    const c = connect(url, { forceNew: true, transports: ['websocket'] });
    clients.push(c);
    return c;
  };
  const stop = async () => {
    clients.forEach((c) => c.disconnect());
    server.io.close();
    await new Promise((r) => server.httpServer.close(r));
  };
  return { server, client, stop };
}

// Resolves with the next `lobby` payload that satisfies `pred`.
const nextLobby = (c, pred = () => true) => new Promise((resolve) => {
  const on = (lobby) => {
    if (!pred(lobby)) return;
    c.off('lobby', on);
    resolve(lobby);
  };
  c.on('lobby', on);
});

test('two players typing the same room code end up in the same lobby', async () => {
  const { client, stop } = await startServer();
  try {
    const a = client();
    const b = client();
    assert.equal((await a.emitWithAck('join', { name: 'Aynur', room: 'main', token: 'tok-a' })).code, 'MAIN');
    const both = nextLobby(a, (l) => l.members.length === 2);
    assert.ok((await b.emitWithAck('join', { name: 'Babək', room: 'Main', token: 'tok-b' })).ok);
    const lobby = await both;
    assert.deepEqual(lobby.members.map((m) => m.name), ['Aynur', 'Babək']);
    assert.equal(lobby.hostId, 'tok-a');
    assert.equal(lobby.maxPlayers, 8);
  } finally {
    await stop();
  }
});

test('a short disconnect keeps the seat; the same token re-joins the same room', async () => {
  const { client, stop } = await startServer();
  try {
    const a = client();
    const b = client();
    await a.emitWithAck('join', { name: 'Aynur', room: 'MAIN', token: 'tok-a' });
    await b.emitWithAck('join', { name: 'Babək', room: 'MAIN', token: 'tok-b' });
    const offline = nextLobby(b, (l) => l.members.some((m) => m.id === 'tok-a' && !m.online));
    a.disconnect();
    await offline;
    const a2 = client();
    const back = nextLobby(b, (l) => l.members.length === 2 && l.members.every((m) => m.online));
    assert.ok((await a2.emitWithAck('join', { name: 'Aynur', room: 'MAIN', token: 'tok-a' })).ok);
    const lobby = await back;
    assert.equal(lobby.hostId, 'tok-a', 'host keeps the room after reconnecting');
  } finally {
    await stop();
  }
});

test('a player who never comes back is removed after the grace period and hosting moves on', async () => {
  const { client, stop } = await startServer();
  try {
    const a = client();
    const b = client();
    await a.emitWithAck('join', { name: 'Aynur', room: 'MAIN', token: 'tok-a' });
    await b.emitWithAck('join', { name: 'Babək', room: 'MAIN', token: 'tok-b' });
    const gone = nextLobby(b, (l) => l.members.length === 1);
    a.disconnect();
    const lobby = await gone;
    assert.equal(lobby.hostId, 'tok-b');
  } finally {
    await stop();
  }
});

test('open rooms are listed, solo rooms are not; up to 8 seats with bots', async () => {
  const { client, stop } = await startServer();
  try {
    const a = client();
    const s = client();
    await a.emitWithAck('join', { name: 'Aynur', room: 'PARTY', token: 'tok-a' });
    await s.emitWithAck('join', { name: 'Solo', room: 'SOLOABCD', token: 'tok-s' });
    for (let i = 0; i < 7; i++) assert.ok((await a.emitWithAck('addBot', { level: 'easy' })).ok);
    assert.equal((await a.emitWithAck('addBot', { level: 'easy' })).error, 'room_full');
    const list = await a.emitWithAck('listRooms', {});
    assert.deepEqual(list, [{ code: 'PARTY', players: 8, max: 8, inGame: false }]);
    await wait(10);
  } finally {
    await stop();
  }
});
