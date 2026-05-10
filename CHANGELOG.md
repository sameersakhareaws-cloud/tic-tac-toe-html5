# Tic-Tac-Toe HTML5 — Complete Changelog

**Platform:** CrazyGames SDK v3  
**Live URL:** http://145.223.21.59:3002  
**GitHub:** https://github.com/sameersakhareaws-cloud/tic-tac-toe-html5  
**Current Version:** v1.4.0

---

## Table of Contents

1. [Versioning Scheme](#versioning-scheme)
2. [v1.0.0 — Initial Build (May 4)](#v100--initial-build-may-4)
3. [v1.1.0 — CrazyGames Compliance Overhaul (May 8)](#v110--crazygames-compliance-overhaul-may-8)
4. [v1.2.0 — Wager System & Multiplayer Fixes (May 8)](#v120--wager-system--multiplayer-fixes-may-8)
5. [v1.3.0 — Polish, Rematch Modal & Versioning (May 10)](#v130--polish-rematch-modal--versioning-may-10)
6. [Architecture Overview](#architecture-overview)
7. [Known Issues & Resolutions](#known-issues--resolutions)
8. [VPS Deployment](#vps-deployment)

---

## Versioning Scheme

Format: `vX.X.X`

| Segment | Meaning | Example |
|---------|---------|---------|
| **X** (major) | Major feature releases / milestones | v1 → v2 = complete rewrite or platform change |
| **X** (minor) | Feature additions within a major | v1.2 → v1.3 = new feature set added |
| **X** (patch) | Bug fixes and minor improvements | v1.3.0 → v1.3.1 = bug fix |

---

## v1.0.0 — Initial Build (May 4)

### Features
- **Core Game:** Full Tic-Tac-Toe logic — board rendering, move validation, win/draw detection, ghost marks on hover
- **Single Player Mode:** Local play with turn indicator and win/draw announcements
- **Multiplayer Mode:** Real-time room-based multiplayer via WebSocket relay server
  - Host creates room → 6-char room code generated
  - Guest joins via code
  - Moves relayed through server
  - Rematch support (server-side)
- **5-Screen UI Flow:** Loading → Main Menu → Lobby → Game → Game Over
- **CrazyGames SDK v3 Integration:** SDK initialization, user auth, room tracking, invite links
- **WebSocket Server:** Node.js + `ws` library, room management, message relay, port 3000
- **Local Dev Fallback:** localStorage events for cross-tab multiplayer when WebSocket unavailable
- **Responsive Design:** Dark theme, mobile-friendly, touch-optimized

### Bugs Fixed (7)
1. **Sensitive files leaked** — Workspace files (AGENTS.md, MEMORY.md, etc.) accidentally committed → removed, restructured repo, added .gitignore
2. **UI.display undefined crash** — `UI.display.roomCodeInput` referenced in main.js but `display` not exposed in UI module return → used `getElementById` directly
3. **connect() never resolves** — WebSocket `onerror` cleared timeout but never called `fallbackToLocal`, game hung on loading screen forever → rewrote with `resolved` flag, both error and timeout paths properly fall back
4. **BroadcastChannel cross-browser** — BroadcastChannel only works same-browser → replaced with localStorage `storage` events (works cross-browser on same origin)
5. **Guest never starts game** — `roomJoined` handler didn't call `startGame()` for guest, only host got `opponentJoined` → guest now starts game on `roomJoined`
6. **Rematch broken for guest** — Server only sent `rematch_accepted` to host → now sends to both players
7. **Rematch double-start** — Both players could trigger rematch simultaneously → guest auto-accepts, server confirms to both

---

## v1.1.0 — CrazyGames Compliance Overhaul (May 8)

All 15 improvements applied to meet CrazyGames SDK requirements.

### Must-Do (7)
1. **loadingStart/Stop lifecycle** — `CG.loadingStart()` on init, `CG.loadingStop()` before showing menu
2. **gameplayStart timing** — `CG.gameplayStart()` called when game screen becomes active
3. **removeJoinRoomListener** — Properly cleaned up join room listener to prevent memory leaks
4. **Ad overlay** — Full-screen overlay during ads with spinner and "Loading advertisement..." text
5. **host updateRoom** — `CG.updateRoom()` called with room metadata after game ends
6. **-webkit-user-select** — Added vendor prefix for iOS text selection prevention
7. **iOS audio resume** — AudioContext resume on `touchend`/`click` for iOS Safari

### Should-Do (6)
1. **Rematch room persistence** — Room kept alive after game ends for rematch flow
2. **Sound effects (Web Audio API)** — Click, win, lose, draw, coin sounds using oscillator-based synthesis
3. **CG username display** — `CG.getUsername()` shown in user info and player tags
4. **Disconnect modal** — Modal overlay when opponent disconnects with "Create New Room" and "Main Menu" options
5. **ByteBrew analytics** — SDK integration with game ID `07qjah_u6`, custom event tracking
6. **Sitelock** — Domain whitelist: crazygames.com domains + localhost + VPS IP

### Nice-to-Have (3)
1. **Loading progress bar** — Animated progress bar during initialization (0% → 100%)
2. **Streamlined menu** — Cleaner menu layout with Play Now, Create Room, Join Room buttons
3. **Coin HUD** — Persistent coin balance display on game screens

---

## v1.2.0 — Wager System & Multiplayer Fixes (May 8)

### Features
- **Wager System:** Full coin economy for multiplayer
  - Host sets wager amount via slider (10–500 coins, step 25)
  - Guest sees host's wager and confirms (locked to match)
  - Pot = wager × 2
  - Winner takes pot, loser loses wager
  - Draw → both refunded
- **Coin HUD:** Persistent 💰 balance display on lobby, wager, game, and gameover screens
- **Coin Win Animation:** Flying "+N 💰" animation on wager win
- **Coin Pulse Animation:** HUD pulses on balance change
- **Wager Screen:** Host/guest names, balances, slider, pot display, warning messages
- **Get Coins Button:** Rewarded ad integration for earning coins
- **Ad Cooldown Timer:** Shows countdown until next ad is available
- **Room Code on Wager Screen:** Display + copy button with invite link
- **Lobby Wager Info:** Shows wager and pot amounts once both players connected

### Bugs Fixed
1. **Wager validation logic** — Proper min/max bounds, step calculation, guest balance check
2. **Join error handling** — Better error messages for invalid room codes, full rooms
3. **Host reconnect grace period** — Host can reconnect without room being destroyed
4. **Copy button** — Fallback clipboard copy for non-HTTPS contexts
5. **Guest lobby UI** — Proper state transitions when guest joins/leaves
6. **Wager screen guest mode** — Slider locked to host's amount for guest
7. **Debug logging** — Console logging for join flow troubleshooting

---

## v1.4.0 — Blind Bid Wager System (May 10)

### Feature: Poker-Style Blind Bid Wager
Replaced the old host-only wager system with a fair blind bidding system:
- **Both players bid secretly** — each player sets their wager privately using a slider or quick-bid presets
- **Quick bid presets** — 10, 50, 100, 200, ALL IN buttons for fast bidding
- **Minimum wins resolution** — the lower of the two bids becomes the final wager (both must be comfortable)
- **Dramatic reveal** — both bids are revealed side-by-side with animation
- **Confidence bonus** — if both players bid the exact same amount, a 10% bonus is added to the pot
- **Veto power** — either player can veto the result and play a free game instead
- **Wager deducted at game start** — both players' coins are deducted when the game begins
- **Server-side bid handling** — new `place_bid`, `veto_bid`, `bid_start` message types

### UI Changes
- New 3-phase wager screen: Bid → Waiting → Reveal
- Quick bid preset buttons
- Reveal animation with VS display
- Veto and Start Game buttons in reveal phase
- Updated CSS for all new UI elements

## v1.3.2 — WS Port Fix & Debug Logging (May 10)

### Bug Fix
- **WebSocket port mismatch** — `WS_URL` was hardcoded to port 3000 but server runs on port 3002. Changed to `ws://' + window.location.host` so it always matches the serving port.
- **Added global error handlers** — `window.onerror` and `unhandledrejection` to catch silent JS errors.
- **Added flow debug logging** — console logs throughout the join flow for easier debugging.

### PM2 Setup
- Restored master `ecosystem.config.js` managing all 3 projects (tic-tac-toe:3002, deciderai:3001, pm2-webui:4343)
- `pm2 save` to persist across restarts

## v1.3.1 — Rematch Room Reuse Fix (May 10)

### Bug Fix
- **Rematch creates new room instead of reusing existing one** — Both the "Play Again" handler and the "Rematch Accept" handler were calling `Multiplayer.createRoom()` which generated a new room code. Fixed by:
  - Storing `rematchRoom` state variable to track the original room
  - "Play Again" now calls `Multiplayer.requestRematch()` on the existing room instead of creating a new one
  - "Rematch Accept" calls `Multiplayer.acceptRematch()` on the existing room
  - `rematchAccepted` event handler shows wager screen on the same room (no `createRoom()` call)
  - Added proper `rematchRoom` cleanup on leave/reject/menu navigation
- **WS port mismatch** — Game was connecting to port 3002 but server runs on 3000. Updated `WS_URL` to port 3000.

## v1.3.0 — Polish, Rematch Modal & Versioning (May 10)

### Features
- **Rematch Request Modal:** Interactive modal for rematch flow
  - Opponent sees "Your opponent wants a rematch. Accept?" with Accept/Reject buttons
  - Accept → both return to wager screen with room preserved
  - Reject → modal closes, player stays on game over screen
- **Version Display:** `v1.3.0` shown in bottom-right corner of loading screen
  - Format: `vX.X.X` (major.minor.patch)
  - Single source of truth: `VERSION` constant in `js/main.js`
- **Sound Toggle Button:** 🔊 button to mute/unmute all sound effects
- **Connection Status Indicator:** Shows Connected/Connecting/Disconnected state

### UI Polish
- Loading screen layout fixed (progress bar order)
- Player tag CSS fixed (inline styles instead of `:first-child` selectors)
- Animated dots on lobby "Waiting" text
- Emoji + bounce animation on game over screen
- Sound button repositioned to bottom-left (no overlap with connection status)
- Improved mobile responsive breakpoints
- Cell `:active` state for touch feedback
- Grid layout shift fix (line-height, fixed heights, removed fadeIn animation)

### Bugs Fixed
1. **Grid layout shift** — Cells shifted when placing marks → fixed with line-height: 1, fixed header/player tag widths, removed fadeIn from `.screen.active`
2. **Rematch auto-accept replaced** — Was auto-accepting rematch requests → now shows interactive modal

---

## Architecture Overview

```
index.html              → Entry point, 5 screens, modals, overlays, SDK loading
css/style.css           → Dark theme, responsive, mobile-friendly, animations
js/game.js              → Pure game logic (board, win detection, moves)
js/multiplayer.js       → Room management, WebSocket/localStorage relay, rematch
js/crazygames.js        → CG SDK wrapper (ads, user, rooms, invites)
js/ui.js                → DOM manipulation, screen transitions, modals
js/wager.js             → Coin economy, wager logic, ad cooldown
js/sitelock.js          → Domain whitelist enforcement
js/main.js              → App orchestrator, event handlers, sound, analytics
server/server.js        → Node.js WebSocket relay server (port 3002)
server/roomManager.js   → Room CRUD, player tracking, message routing
```

### Multiplayer Flow
1. Host clicks "Create Room" → 6-char code → lobby
2. Guest clicks "Join Room" → enters code → lobby
3. Host sets wager → guest confirms → game starts
4. Moves relayed via WebSocket (or localStorage in dev)
5. Game over → wager settled → rematch or menu
6. Rematch: request → modal → accept/reject → back to wager screen

### Screens
1. **Loading** — Spinner, progress bar, version display
2. **Main Menu** — Play Now, Create Room, Join Room
3. **Wager** — Slider, pot, confirm (host) / locked confirm (guest)
4. **Lobby** — Room code, player names, wager info, invite, leave
5. **Game** — Board, turn indicator, player tags, pot display
6. **Game Over** — Result emoji, text, coin change, Play Again, Main Menu

### Modals
- **Disconnect Modal** — Opponent disconnected, Create New Room / Main Menu
- **Rematch Request Modal** — Opponent wants rematch, Accept / Reject

---

## Known Issues & Resolutions

| Issue | Status | Resolution |
|-------|--------|------------|
| Sensitive files in git | ✅ Fixed | Removed, added .gitignore |
| UI.display undefined | ✅ Fixed | Used getElementById directly |
| connect() never resolves | ✅ Fixed | Proper fallback with resolved flag |
| BroadcastChannel cross-browser | ✅ Fixed | Replaced with localStorage events |
| Guest never starts game | ✅ Fixed | roomJoined triggers startGame() |
| Rematch broken for guest | ✅ Fixed | Server sends to both players |
| Rematch double-start | ✅ Fixed | Guest auto-accepts, server confirms |
| Sitelock redirect on IP access | ✅ Fixed | Added IP to whitelist |
| Grid layout shift | ✅ Fixed | CSS fixes (line-height, fixed heights) |
| Plugin-symlink wipe on restart | ⚠️ Known | Use `cp -rL` instead of symlinks |

---

## VPS Deployment

| Service | URL | Process |
|---------|-----|---------|
| Tic-Tac-Toe Game | http://145.223.21.59:3002 | PM2 `tic-tac-toe` (WS relay + static) |
| DeciderAI | http://145.223.21.59:3001 | PM2 `deciderai` |
| PM2 Dashboard | http://145.223.21.59:4343/apps | PM2 `pm2-webui` |

### Deployment Commands
```bash
# Restart game server
pm2 restart tic-tac-toe

# View logs
pm2 logs tic-tac-toe

# Check status
pm2 list
```

---

*Last updated: 2026-05-10*
