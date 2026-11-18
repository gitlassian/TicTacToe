// Tic-tac-toe browser client. Protocol: game-protocol.md (v1).
// The server is the source of truth: the client only sends intents and draws `state`.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    lobby: $("lobby"), game: $("game"),
    name: $("name"), create: $("create"), joinForm: $("join-form"), code: $("code"),
    roomCode: $("room-code"), copy: $("copy"),
    players: { X: $("player-X"), O: $("player-O") },
    status: $("status"), board: $("board"),
    rematch: $("rematch"), leave: $("leave"),
    error: $("error"), conn: $("conn"),
  };

  const ERRORS = {
    room_not_found: "Комната не найдена",
    room_full: "В комнате уже два игрока",
    not_your_turn: "Сейчас не твой ход",
    cell_taken: "Клетка уже занята",
    game_over: "Игра уже закончилась",
    bad_request: "Сервер не понял запрос",
  };

  let ws = null;
  let queue = [];
  let room = null;   // room code once joined
  let you = null;    // "X" | "O"
  let state = null;  // last `state` from the server
  let rematchAsked = false;
  let errorTimer = null;

  // ---------- connection ----------

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    setConn("Подключаемся…");
    ws.addEventListener("open", () => {
      setConn("");
      for (const msg of queue) ws.send(JSON.stringify(msg));
      queue = [];
    });
    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handle(msg);
    });
    ws.addEventListener("close", () => {
      ws = null;
      queue = [];
      setConn(room ? "Соединение потеряно. Обнови страницу, чтобы начать заново." : "Нет связи с сервером.");
      if (room) render(); // freeze the board
    });
  }

  function send(msg) {
    if (!ws) connect();
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queue.push(msg);
  }

  // ---------- incoming ----------

  function handle(msg) {
    switch (msg.type) {
      case "joined":
        room = msg.room;
        you = msg.you;
        rematchAsked = false;
        history.replaceState(null, "", `?room=${encodeURIComponent(room)}`);
        showGame();
        render();
        break;
      case "state":
        if (msg.you === "X" || msg.you === "O") you = msg.you;
        if (msg.status === "playing" || msg.status === "waiting") rematchAsked = false;
        state = msg;
        render();
        break;
      case "error":
        showError(ERRORS[msg.code] || msg.message || "Ошибка");
        break;
    }
  }

  // ---------- rendering ----------

  function showGame() {
    ui.lobby.hidden = true;
    ui.game.hidden = false;
    ui.roomCode.textContent = room;
  }

  function showLobby() {
    ui.game.hidden = true;
    ui.lobby.hidden = false;
  }

  function buildBoard() {
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      cell.dataset.i = String(i);
      cell.setAttribute("role", "gridcell");
      ui.board.appendChild(cell);
    }
  }

  function render() {
    const s = state;
    const online = !!ws && ws.readyState === WebSocket.OPEN;
    const board = s ? s.board : Array(9).fill(null);
    const myTurn = online && s && s.status === "playing" && s.turn === you;
    const line = new Set((s && s.line) || []);

    [...ui.board.children].forEach((cell, i) => {
      const v = board[i];
      cell.textContent = v || "";
      cell.className = "cell" + (v ? " " + v.toLowerCase() : "") + (line.has(i) ? " win" : "");
      const playable = myTurn && !v;
      cell.disabled = !playable;
      if (playable) cell.classList.add("playable");
      cell.setAttribute("aria-label", `Клетка ${i + 1}: ${v || "пусто"}`);
    });

    for (const mark of ["X", "O"]) {
      const el = ui.players[mark];
      const p = s && s.players ? s.players[mark] : null;
      el.querySelector(".pname").textContent = p ? (p.name || "Игрок") : "ждём…";
      el.classList.toggle("me", mark === you);
      el.classList.toggle("turn", !!s && s.status === "playing" && s.turn === mark);
      el.classList.toggle("off", !!p && p.connected === false);
    }

    ui.status.textContent = statusText(s, online);
    const over = !!s && (s.status === "won" || s.status === "draw");
    ui.rematch.hidden = !over;
    ui.rematch.disabled = rematchAsked || !online;
    ui.rematch.textContent = rematchAsked ? "Ждём соперника…" : "Реванш";
  }

  function statusText(s, online) {
    if (!s) return "Ждём сервер…";
    switch (s.status) {
      case "waiting": return "Ждём второго игрока. Отправь ему код комнаты.";
      case "playing":
        if (!online) return "Нет связи";
        return s.turn === you ? "Твой ход" : "Ход соперника";
      case "won": return s.winner === you ? "Ты победил! 🎉" : "Соперник победил";
      case "draw": return "Ничья";
      case "abandoned": return "Соперник вышел из игры";
      default: return "";
    }
  }

  function showError(text) {
    ui.error.textContent = text;
    ui.error.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { ui.error.hidden = true; }, 3000);
  }

  function setConn(text) { ui.conn.textContent = text; }

  // ---------- actions ----------

  function playerName() {
    const name = ui.name.value.trim().slice(0, 20);
    try { localStorage.setItem("ttt-name", name); } catch {}
    return name || undefined;
  }

  ui.create.addEventListener("click", () => {
    send({ type: "create", name: playerName() });
  });

  ui.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = ui.code.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { showError("Код комнаты: 4 буквы"); return; }
    send({ type: "join", room: code, name: playerName() });
  });

  ui.code.addEventListener("input", () => {
    ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  ui.board.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || cell.disabled) return;
    send({ type: "move", cell: Number(cell.dataset.i) });
  });

  ui.rematch.addEventListener("click", () => {
    rematchAsked = true;
    send({ type: "rematch" });
    render();
  });

  ui.leave.addEventListener("click", () => {
    if (ws) ws.close();
    room = you = state = null;
    rematchAsked = false;
    history.replaceState(null, "", location.pathname);
    setConn("");
    showLobby();
  });

  ui.copy.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?room=${room}`;
    try {
      await navigator.clipboard.writeText(url);
      ui.copy.textContent = "скопировано";
    } catch {
      ui.copy.textContent = url;
    }
    setTimeout(() => { ui.copy.textContent = "скопировать ссылку"; }, 2000);
  });

  // ---------- start ----------

  buildBoard();
  try { ui.name.value = localStorage.getItem("ttt-name") || ""; } catch {}
  const fromUrl = new URLSearchParams(location.search).get("room");
  if (fromUrl && /^[A-Za-z]{4}$/.test(fromUrl)) ui.code.value = fromUrl.toUpperCase();
  (fromUrl ? ui.code : ui.name).focus();
})();
