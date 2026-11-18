# TicTacToe

Online tic-tac-toe for two players in a browser.

- `server/`: Node + WebSocket game server; it also serves `client/` at `/`.
- `client/`: browser client, plain HTML/CSS/JS with no build step.

## Run

```sh
cd server
npm install
npm start          # http://localhost:8080 (port is set with PORT)
```

Open the page, create a room and send the 4-letter code to a friend (or open a second tab).
