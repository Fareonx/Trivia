// Socket.io wrapper: promise-based calls and a server clock estimate so that
// knight movement and timers render in sync with the server.

const TOKEN_KEY = 'zd_token';

// sessionStorage: one seat per browser tab, kept across page refreshes.
function playerToken() {
  try {
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    return String(Math.random()).slice(2);
  }
}

export function connect() {
  const socket = window.io();
  let offset = 0;
  const call = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

  async function syncClock() {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const server = await call('ping_time');
      const t1 = Date.now();
      if (t1 - t0 < best) {
        best = t1 - t0;
        offset = server + (t1 - t0) / 2 - t1;
      }
    }
  }

  socket.on('connect', syncClock);

  return {
    socket,
    call,
    token: playerToken(),
    serverNow: () => Date.now() + offset,
  };
}
