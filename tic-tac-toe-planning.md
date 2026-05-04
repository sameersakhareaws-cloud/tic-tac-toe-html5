# Tic-Tac-Toe HTML5 — Planning Document

## 1. Overview
A Tic-Tac-Toe HTML5 game with multiplayer room functionality, built for integration with the CrazyGames SDK v3. Players can create rooms, invite friends via links or the CrazyGames friends system, and play in real-time.

**Tech Stack:**
- Frontend: HTML5, CSS3, JavaScript (Canvas or DOM-based)
- Real-time multiplayer: WebSocket (or Firebase Realtime Database / PeerJS for P2P signaling)
- Backend: Node.js + WebSocket server (simple room matching & relay)
- Platform SDK: CrazyGames SDK v3 (`crazygames-sdk-v3.js`)
- Hosting: GitHub Pages (for local dev), CrazyGames for production
- Repository: `github.com/sameersakhareaws-cloud/tic-tac-toe-html5`

---

## 2. CrazyGames SDK Integration

### 2.1 SDK Loading
```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```
Initialize before game starts (on loading screen):
```js
await window.CrazyGames.SDK.init();
```

### 2.2 Modules Used
| Module | Purpose | Key Methods |
|--------|---------|-------------|
| **Game** | Room tracking, gameplay events, invites | `updateRoom()`, `leftRoom()`, `addJoinRoomListener()`, `inviteLink()`, `getInviteParam()`, `inviteParams`, `isInstantMultiplayer`, `loadingStart()`, `loadingStop()`, `gameplayStart()`, `gameplayStop()` |
| **User** | Get logged-in user info | `getUser()`, `isUserAccountAvailable`, `systemInfo` |
| **Ad** | Midgame & rewarded ads | `requestAd()`, `hasAdblock()` |
| **Data** | Cloud save (future) | `getData()`, `setData()` |

### 2.3 Multiplayer Flow (CrazyGames Requirements)

1. **Instant Multiplayer:** Check `SDK.game.isInstantMultiplayer` on init → if true, auto-create a room
2. **Room Data Tracking:** Call `SDK.game.updateRoom({ roomId, isJoinable, inviteParams })` when room state changes
3. **Invite Links:** Use `SDK.game.inviteLink({ roomId })` to generate shareable links; read `SDK.game.inviteParams` on load to detect incoming joins
4. **Room Join Listener:** `SDK.game.addJoinRoomListener(callback)` for in-game join events
5. **User Display:** Show `SDK.user.getUser().username` in-game so friends can recognize each other

### 2.4 Ad Integration
- **Midgame ad:** Show between rounds (game over → next round)
- **Rewarded ad:** Optional "watch ad to undo last move" (stretch goal)
- Always pause game + mute audio during ads

### 2.5 Game Lifecycle Events
- `loadingStart()` on game boot
- `loadingStop()` when assets loaded
- `gameplayStart()` when a round begins
- `gameplayStop()` when game is paused/ended
- `happytime()` on win (optional celebration)

---

## 3. Game Architecture

### 3.1 File Structure
```
tic-tac-toe-html5/
├── index.html              # Entry point, SDK init, game container
├── css/
│   └── style.css           # All styles (responsive, mobile-friendly)
├── js/
│   ├── main.js             # Game entry, state management, UI
│   ├── game.js             # Tic-Tac-Toe logic (board, win check, turn)
│   ├── multiplayer.js      # WebSocket/P2P connection, room management
│   ├── crazygames-sdk.js   # Wrapper around CG SDK for clean integration
│   └── ui.js               # DOM manipulation, screen transitions
├── server/
│   └── server.js           # Node.js WebSocket server for room relay
├── assets/                 # Images, sounds (minimal for Tic-Tac-Toe)
├── package.json
└── README.md
```

### 3.2 Screens / States
1. **Loading Screen** — SDK init, asset loading
2. **Main Menu** — Single Player / Create Room / Join Room / Invite Friends
3. **Lobby / Waiting Room** — Show room code, invite button, "waiting for opponent"
4. **Game Board** — 3×3 grid, turn indicator, player names
5. **Game Over Screen** — Winner/draw display, play again, share result
6. **Friend Invite Modal** — (CrazyGames friends drawer integration)

### 3.3 Game State Machine
```
LOADING → MENU → [SINGLE_PLAYER | MULTIPLAYER_LOBBY] → PLAYING → GAME_OVER → MENU
                                        ↑_______________|
```

---

## 4. Multiplayer Design

### 4.1 Room System
- **Room ID:** 6-character alphanumeric code (e.g., `ABC123`)
- **Max players per room:** 2
- **Room lifecycle:** Created → Waiting → Playing → Game Over → Rematch or Close

### 4.2 Communication Architecture
```
Player A ←→ WebSocket Server ←→ Player B
              (Room relay / matchmaking)
```
- Simple Node.js server using `ws` library
- Messages: `create_room`, `join_room`, `move`, `rematch`, `leave`, `chat`
- Fallback: If WebSocket server unavailable, use PeerJS (WebRTC) for direct P2P

### 4.3 Synchronization
- Host (X) creates room, shares code
- Guest (O) joins with code
- Moves sent as `{ cell: 0-8, player: 'X'|'O' }`
- Server validates turn order, broadcasts to both players
- Simple conflict resolution: server timestamp

### 4.4 CrazyGames Invite Integration
1. Player creates room
2. Game calls `SDK.game.inviteLink({ roomId: "ABC123" })`
3. Generated link shared via CG UI or copied to clipboard
4. Opening link auto-fills room code → joins room

### 4.5 CrazyGames "Play with Friends"
1. After creating room, call:
   ```js
   SDK.game.updateRoom({
     roomId: "ABC123",
     isJoinable: true,
     inviteParams: { roomId: "ABC123" }
   });
   ```
2. CG UI shows invite button to friends
3. Friend clicks invite → `addJoinRoomListener` fires in-game
4. Game handles join, navigates to lobby

---

## 5. UI/UX Specifications

### 5.1 Visual Style
- Clean, modern, minimal
- Dark theme (easy on the eyes for a casual game)
- Animated transitions between screens
- Responsive: works on desktop & mobile (CG requirement)

### 5.2 Board Design
```
  X │ O │ X
 ───┼───┼───
    │ X │
 ───┼───┼───
  O │   │ O
```
- Large touch targets for mobile
- Hover effects on desktop
- Winning line animation (strikethrough or highlight)

### 5.3 Information Display
- Player names (from CrazyGames `getUser().username` or "Player 1/2")
- Current turn indicator
- Room code (copy button)
- Connection status (connected/disconnected)

---

## 6. Development Phases

### Phase 1: Core Game + SDK (Day 1)
- [ ] Scaffold project, set up repo
- [ ] Build Tic-Tac-Toe game logic (single player)
- [ ] Implement all screens (menu, board, game over)
- [ ] Integrate CrazyGames SDK (init, user, game lifecycle)
- [ ] Implement ads (midgame between rounds)

### Phase 2: Multiplayer (Day 2)
- [ ] Build WebSocket server (`server/server.js`)
- [ ] Implement room creation/joining in client
- [ ] Sync game state between two players
- [ ] Handle disconnects/reconnects

### Phase 3: CrazyGames Multiplayer Integration (Day 2-3)
- [ ] Integrate `updateRoom()`, `leftRoom()`
- [ ] Implement invite links (`inviteLink`, `inviteParams`)
- [ ] Add room join listener (`addJoinRoomListener`)
- [ ] Handle `isInstantMultiplayer` flag
- [ ] Show CG usernames in-game

### Phase 4: Polish & Testing (Day 3)
- [ ] Responsive design, mobile layout
- [ ] Sound effects (optional)
- [ ] Adblock detection & graceful handling
- [ ] Game context feedback (`setGameContext`)
- [ ] Cross-browser testing
- [ ] Submit to CrazyGames QA tool

---

## 7. Server Deployment

- WebSocket server deployed on a free-tier cloud service (Railway/Render)
- Client connects via `wss://` URL
- Server is minimal: room management + message relay only
- No persistent storage needed (rooms are ephemeral)

---

## 8. CrazyGames Submission Checklist

- [ ] SDK v3 loaded and initialized
- [ ] `loadingStart()` / `loadingStop()` called
- [ ] `gameplayStart()` / `gameplayStop()` called
- [ ] User account (`getUser()`) required for multiplayer
- [ ] Room data reported via `updateRoom()`
- [ ] Invite links working
- [ ] Instant multiplayer support
- [ ] Game plays correctly with adblock
- [ ] Audio muted during ads
- [ ] Responsive on mobile & desktop
- [ ] No external domain dependencies (except CG SDK)
- [ ] File size reasonable (< 5MB ideal for web)
