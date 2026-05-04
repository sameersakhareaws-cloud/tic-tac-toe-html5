# ⚡ Tic-Tac-Toe HTML5

A Tic-Tac-Toe HTML5 game with multiplayer room functionality, designed for CrazyGames.

## Features

- 🎮 Single player mode
- 🌐 Real-time multiplayer with room codes
- 🔗 Invite links (CrazyGames SDK integration)
- 👥 Friends invite via CrazyGames platform
- 📱 Responsive design (desktop + mobile)
- 🎬 Ad integration (midgame ads)

## Quick Start

### Play Locally

```bash
# Install dependencies
npm install

# Start WebSocket server
npm start

# In another terminal, serve the client
npx serve . -l 8080

# Open http://localhost:8080
```

### Multiplayer Locally

Use two browser tabs to test multiplayer. The game uses BroadcastChannel as a fallback when no WebSocket server is available.

## Deployment

### Client (GitHub Pages)
1. Push to GitHub
2. Enable GitHub Pages in repo settings

### WebSocket Server (Render)
1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Set `Start Command` to `npm start`
4. Deploy — get your `wss://` URL
5. Update `WS_URL` in `js/multiplayer.js`

### CrazyGames Submission
1. Build the client
2. Zip all files (except `server/`, `node_modules/`)
3. Upload to [CrazyGames Developer Portal](https://developer.crazygames.com)
4. Use the Preview tool to test

## Architecture

```
index.html          → Entry point
css/style.css       → All styles
js/
  crazygames.js     → CG SDK wrapper
  game.js           → Pure game logic (board, win check)
  multiplayer.js    → WebSocket/BroadcastChannel networking
  ui.js             → DOM manipulation, screen transitions
  main.js           → App orchestrator
server/
  server.js         → Node.js WebSocket relay server
```

## CrazyGames SDK

- `CG.SDK.init()` → Initialize on load
- `SDK.game.updateRoom()` → Report room state
- `SDK.game.inviteLink()` → Generate invite link
- `SDK.game.addJoinRoomListener()` → Handle in-game joins
- `SDK.ad.requestAd()` → Show midgame ads
- `SDK.user.getUser()` → Get logged-in user info

## License

MIT
