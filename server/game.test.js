const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { server } = require('./index');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  ws.next = () => new Promise((r) => (inbox.length ? r(inbox.shift()) : waiters.push(r)));
  ws.opened = new Promise((r) => ws.on('open', r));
  return ws;
}

test('full game: X wins, rematch swaps seats', async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const a = client(port), b = client(port);
  await Promise.all([a.opened, b.opened]);

  a.send(JSON.stringify({ type: 'create', name: 'A' }));
  const joined = await a.next();
  assert.equal(joined.you, 'X');
  await a.next(); // waiting state
  b.send(JSON.stringify({ type: 'join', room: joined.room, name: 'B' }));
  assert.equal((await b.next()).you, 'O');
  assert.equal((await a.next()).status, 'playing');
  await b.next();

  const play = async (ws, cell) => { ws.send(JSON.stringify({ type: 'move', cell })); return { a: await a.next(), b: await b.next() }; };
  await play(a, 0); await play(b, 3); await play(a, 1); await play(b, 4);
  const last = await play(a, 2);
  assert.equal(last.a.status, 'won');
  assert.deepEqual(last.a.line, [0, 1, 2]);

  b.send(JSON.stringify({ type: 'move', cell: 5 }));
  assert.equal((await b.next()).code, 'game_over');

  a.send(JSON.stringify({ type: 'rematch' })); await a.next(); await b.next();
  b.send(JSON.stringify({ type: 'rematch' }));
  assert.equal((await a.next()).you, 'O'); // seats swapped
  a.close(); b.close();
  server.close();
});

test('errors', async () => {
  await new Promise((r) => server.listen(0, r));
  const c = client(server.address().port);
  await c.opened;
  c.send(JSON.stringify({ type: 'join', room: 'ZZZZ' }));
  assert.equal((await c.next()).code, 'room_not_found');
  c.send('not json');
  assert.equal((await c.next()).code, 'bad_request');
  c.close();
  server.close();
});
