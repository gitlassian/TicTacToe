const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { checkWinner } = require('./game');

const PORT = Number(process.env.PORT) || 8080;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const rooms = new Map(); // code -> room

function makeCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * 26)];
    if (!rooms.has(code)) return code;
  }
}

function newGame(room) {
  room.board = Array(9).fill(null);
  room.turn = 'X';
  room.winner = null;
  room.line = null;
  room.over = null; // 'won' | 'draw'
  room.rematch = new Set();
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function sendError(ws, code, message) {
  send(ws, { type: 'error', code, message });
}

function status(room) {
  if (room.abandoned) return 'abandoned';
  if (!room.players.O) return 'waiting';
  return room.over || 'playing';
}

function broadcast(room) {
  const players = {};
  for (const seat of ['X', 'O']) {
    const p = room.players[seat];
    players[seat] = p ? { name: p.name, connected: p.ws.readyState === 1 } : null;
  }
  const msg = { type: 'state', board: room.board, turn: room.turn, status: status(room), winner: room.winner, line: room.line, players };
  for (const seat of ['X', 'O']) if (room.players[seat]) send(room.players[seat].ws, msg);
}

function leave(ws) {
  const { room, seat } = ws.ctx || {};
  if (!room) return;
  ws.ctx = {};
  room.players[seat] = null;
  if (!room.players.X && !room.players.O) {
    rooms.delete(room.code);
    return;
  }
  room.abandoned = true;
  broadcast(room);
}

function cleanName(n, seat) {
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 20) : `Player ${seat}`;
}

function handle(ws, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return sendError(ws, 'bad_request', 'Expected {type, ...}');
  const ctx = ws.ctx;
  switch (msg.type) {
    case 'create': {
      if (ctx.room) return sendError(ws, 'bad_request', 'Already in a room');
      const room = { code: makeCode(), players: { X: { ws, name: cleanName(msg.name, 'X') }, O: null }, abandoned: false };
      newGame(room);
      rooms.set(room.code, room);
      ws.ctx = { room, seat: 'X' };
      send(ws, { type: 'joined', room: room.code, you: 'X' });
      return broadcast(room);
    }
    case 'join': {
      if (ctx.room) return sendError(ws, 'bad_request', 'Already in a room');
      const code = typeof msg.room === 'string' ? msg.room.toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return sendError(ws, 'room_not_found', 'No such room');
      if (room.players.O || room.abandoned) return sendError(ws, 'room_full', 'Room is full');
      room.players.O = { ws, name: cleanName(msg.name, 'O') };
      ws.ctx = { room, seat: 'O' };
      send(ws, { type: 'joined', room: room.code, you: 'O' });
      return broadcast(room);
    }
    case 'move': {
      const { room, seat } = ctx;
      if (!room) return sendError(ws, 'bad_request', 'Not in a room');
      if (!Number.isInteger(msg.cell) || msg.cell < 0 || msg.cell > 8) return sendError(ws, 'bad_request', 'cell must be 0..8');
      if (room.over || room.abandoned || !room.players.O) return sendError(ws, 'game_over', 'Game is not in progress');
      if (room.turn !== seat) return sendError(ws, 'not_your_turn', 'Not your turn');
      if (room.board[msg.cell]) return sendError(ws, 'cell_taken', 'Cell is taken');
      room.board[msg.cell] = seat;
      const { winner, line } = checkWinner(room.board);
      if (winner) {
        room.winner = winner; room.line = line; room.over = 'won';
      } else if (room.board.every(Boolean)) {
        room.over = 'draw';
      } else {
        room.turn = seat === 'X' ? 'O' : 'X';
      }
      return broadcast(room);
    }
    case 'rematch': {
      const { room, seat } = ctx;
      if (!room) return sendError(ws, 'bad_request', 'Not in a room');
      if (!room.over || room.abandoned) return sendError(ws, 'bad_request', 'Game is not over');
      room.rematch.add(seat);
      if (room.rematch.size === 2) {
        // swap seats
        const { X, O } = room.players;
        room.players.X = O; room.players.O = X;
        room.players.X.ws.ctx.seat = 'X';
        room.players.O.ws.ctx.seat = 'O';
        newGame(room);
        send(room.players.X.ws, { type: 'joined', room: room.code, you: 'X' });
        send(room.players.O.ws, { type: 'joined', room: room.code, you: 'O' });
      }
      return broadcast(room);
    }
    default:
      return sendError(ws, 'bad_request', `Unknown type: ${msg.type}`);
  }
}

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(CLIENT_DIR, path.normalize(rel));
  if (!file.startsWith(CLIENT_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.ctx = {};
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return sendError(ws, 'bad_request', 'Invalid JSON'); }
    handle(ws, msg);
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`TicTacToe server on http://localhost:${PORT}`));
}
module.exports = { server, wss, rooms };
