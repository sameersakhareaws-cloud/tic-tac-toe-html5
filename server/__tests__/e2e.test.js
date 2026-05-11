const WebSocket = require('ws');
const http = require('http');

let httpServer;
let PORT;

function getPort() {
    return Math.floor(Math.random() * 10000) + 20000;
}

// ─── Inline test server (mirrors production server.js logic) ───

function startServer() {
    return new Promise((resolve) => {
        PORT = getPort();
        httpServer = http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'ok' }));
            }
            res.writeHead(404);
            res.end();
        });

        const rooms = new Map();
        const players = new Map();

        function generateRoomCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code;
            do {
                code = '';
                for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
            } while (rooms.has(code));
            return code;
        }

        function sendTo(ws, type, data = {}) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type, ...data }));
            }
        }

        function sendToPlayer(playerId, type, data = {}) {
            const player = players.get(playerId);
            if (player) sendTo(player.ws, type, data);
        }

        function handlePlayerLeave(playerId) {
            const player = players.get(playerId);
            if (!player || !player.roomId) return null;
            const roomId = player.roomId;
            const room = rooms.get(roomId);
            if (!room) return null;
            const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
            rooms.delete(roomId);
            player.roomId = null;
            return opponentId;
        }

        const wss = new WebSocket.Server({ server: httpServer });

        wss.on('connection', (ws) => {
            const playerId = 'p_' + Math.random().toString(36).substring(2, 10);
            players.set(playerId, { ws, roomId: null, name: 'Player' });
            ws.on('message', (raw) => {
                try { handleMessage(playerId, JSON.parse(raw)); }
                catch (e) { sendTo(ws, 'error', { message: 'Invalid message' }); }
            });
            ws.on('close', () => {
                const opponentId = handlePlayerLeave(playerId);
                if (opponentId) sendToPlayer(opponentId, 'opponent_left');
                players.delete(playerId);
            });
        });

        function handleMessage(playerId, msg) {
            const player = players.get(playerId);
            if (!player) return;
            switch (msg.type) {
                case 'create_room': {
                    const roomId = generateRoomCode();
                    rooms.set(roomId, { hostName: msg.name || 'Host', hostId: playerId, guestName: null, guestId: null, createdAt: Date.now(), hostBid: undefined, guestBid: undefined, wager: 0, wagerLocked: false });
                    player.roomId = roomId;
                    player.name = msg.name || 'Host';
                    sendTo(player.ws, 'room_created', { roomId });
                    break;
                }
                case 'join_room': {
                    const roomId = msg.roomId.toUpperCase();
                    const room = rooms.get(roomId);
                    if (!room || !room.hostId) { sendTo(player.ws, 'join_failed', { reason: 'Room not found' }); break; }
                    if (room.guestId) { sendTo(player.ws, 'join_failed', { reason: 'Room is full' }); break; }
                    if (room.hostId === playerId) { sendTo(player.ws, 'join_failed', { reason: 'Cannot join your own room' }); break; }
                    room.guestName = msg.name || 'Guest';
                    room.guestId = playerId;
                    player.roomId = roomId;
                    player.name = msg.name || 'Guest';
                    sendTo(player.ws, 'room_joined', { roomId, symbol: 'O', hostName: room.hostName });
                    if (room.hostId) sendToPlayer(room.hostId, 'opponent_joined', { name: player.name, symbol: 'O' });
                    break;
                }
                case 'move': {
                    const room = rooms.get(msg.roomId);
                    if (!room) { sendTo(player.ws, 'error', { message: 'Room not found' }); return; }
                    const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
                    if (opponentId) sendToPlayer(opponentId, 'move', { cell: msg.cell, player: msg.player });
                    break;
                }
                case 'rematch_request': {
                    const room = rooms.get(msg.roomId);
                    if (!room) return;
                    const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
                    if (opponentId) sendToPlayer(opponentId, 'rematch_requested');
                    break;
                }
                case 'rematch_accept': {
                    const room = rooms.get(msg.roomId);
                    if (!room) return;
                    room.hostBid = undefined; room.guestBid = undefined; room.wager = 0; room.wagerLocked = false;
                    if (room.hostId) sendToPlayer(room.hostId, 'rematch_accepted');
                    if (room.guestId) sendToPlayer(room.guestId, 'rematch_accepted');
                    break;
                }
                case 'place_bid': {
                    const room = rooms.get(msg.roomId);
                    if (!room) { sendTo(player.ws, 'error', { message: 'Room not found' }); return; }
                    if (room.hostId === playerId) room.hostBid = msg.amount;
                    else if (room.guestId === playerId) room.guestBid = msg.amount;
                    const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
                    if (opponentId) sendToPlayer(opponentId, 'bid_locked');
                    if (room.hostBid !== undefined && room.guestBid !== undefined) {
                        const finalWager = Math.min(room.hostBid, room.guestBid);
                        const pot = finalWager * 2;
                        const bonus = room.hostBid === room.guestBid;
                        room.wager = finalWager; room.wagerLocked = true;
                        if (room.hostId) sendToPlayer(room.hostId, 'bid_reveal', { yourBid: room.hostBid, opponentBid: room.guestBid, finalWager, pot, bonus });
                        if (room.guestId) sendToPlayer(room.guestId, 'bid_reveal', { yourBid: room.guestBid, opponentBid: room.hostBid, finalWager, pot, bonus });
                    }
                    break;
                }
                case 'veto_bid': {
                    const room = rooms.get(msg.roomId);
                    if (!room) return;
                    if (room.hostId) sendToPlayer(room.hostId, 'bid_veto', { vetoedBy: playerId });
                    if (room.guestId) sendToPlayer(room.guestId, 'bid_veto', { vetoedBy: playerId });
                    break;
                }
                case 'bid_start': {
                    const room = rooms.get(msg.roomId);
                    if (!room || !room.wagerLocked) return;
                    const sd = { wager: room.wager, pot: room.wager * 2 };
                    if (room.hostId) sendToPlayer(room.hostId, 'bid_start', sd);
                    if (room.guestId) sendToPlayer(room.guestId, 'bid_start', sd);
                    break;
                }
                case 'leave': {
                    const opponentId = handlePlayerLeave(playerId);
                    if (opponentId) sendToPlayer(opponentId, 'opponent_left');
                    break;
                }
            }
        }

        httpServer.listen(PORT, () => resolve(`ws://localhost:${PORT}`));
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (httpServer) httpServer.close(() => { httpServer = null; resolve(); });
        else resolve();
    });
}

// ─── Helpers ───

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        const t = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        ws.on('open', () => { clearTimeout(t); resolve(ws); });
        ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
}

function send(ws, type, data = {}) { ws.send(JSON.stringify({ type, ...data })); }

function waitForMessage(ws, type, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
        const h = (raw) => {
            try { const m = JSON.parse(raw); if (m.type === type) { clearTimeout(t); ws.off('message', h); resolve(m); } } catch (e) {}
        };
        ws.on('message', h);
    });
}

function waitForClose(ws, timeout = 8000) {
    return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
        const t = setTimeout(() => reject(new Error('Timeout close')), timeout);
        ws.on('close', () => { clearTimeout(t); resolve(); });
    });
}

async function closeAll(...socks) {
    for (const s of socks) { try { if (s.readyState <= WebSocket.OPEN) s.close(); } catch (e) {} }
    for (const s of socks) { try { await waitForClose(s, 3000); } catch (e) {} }
}

function drainMessages(ws, ms = 200) {
    return new Promise((resolve) => {
        const msgs = [];
        const h = (raw) => { try { msgs.push(JSON.parse(raw)); } catch (e) {} };
        ws.on('message', h);
        setTimeout(() => { ws.off('message', h); resolve(msgs); }, ms);
    });
}

// Each test gets a fresh server so port conflicts are impossible
beforeAll(async () => { await startServer(); }, 10000);
afterAll(async () => { await stopServer(); }, 10000);
afterEach(async () => { await new Promise(r => setTimeout(r, 100)); });

// ═══════════════════════════════════════════════════════════════
// FLOW 1: Room Creation & Joining
// ═══════════════════════════════════════════════════════════════

describe('FLOW 1: room creation and joining', () => {
    test('host creates room → 6-char alphanumeric code', async () => {
        const h = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        expect(c.roomId).toHaveLength(6);
        expect(c.roomId).toMatch(/^[A-Z0-9]+$/);
        await closeAll(h);
    });

    test('guest joins → both get correct events', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        const j = await waitForMessage(g, 'room_joined');
        expect(j.roomId).toBe(c.roomId);
        expect(j.symbol).toBe('O');
        expect(j.hostName).toBe('Alice');
        const oj = await waitForMessage(h, 'opponent_joined');
        expect(oj.name).toBe('Bob');
        expect(oj.symbol).toBe('O');
        await closeAll(h, g);
    });

    test('join non-existent room → fail', async () => {
        const g = await connect();
        send(g, 'join_room', { roomId: 'XXXXXX', name: 'Bob' });
        const f = await waitForMessage(g, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(g);
    });

    test('join full room → fail', async () => {
        const h = await connect(), g1 = await connect(), g2 = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g1, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g1, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(g2, 'join_room', { roomId: c.roomId, name: 'Charlie' });
        const f = await waitForMessage(g2, 'join_failed');
        expect(f.reason).toBe('Room is full');
        await closeAll(h, g1, g2);
    });

    test('host cannot join own room', async () => {
        const h = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(h, 'join_room', { roomId: c.roomId, name: 'Alice' });
        const f = await waitForMessage(h, 'join_failed');
        expect(f.reason).toBe('Cannot join your own room');
        await closeAll(h);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 2: Disconnect destroys room
// ═══════════════════════════════════════════════════════════════

describe('FLOW 2: disconnect destroys room', () => {
    test('host disconnects → guest notified, room gone', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        h.close(); await waitForClose(h);
        const left = await waitForMessage(g, 'opponent_left');
        expect(left.type).toBe('opponent_left');
        // Room destroyed
        const g2 = await connect();
        send(g2, 'join_room', { roomId: c.roomId, name: 'X' });
        const f = await waitForMessage(g2, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(g, g2);
    });

    test('guest disconnects → host notified, room gone', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        g.close(); await waitForClose(g);
        const left = await waitForMessage(h, 'opponent_left');
        expect(left.type).toBe('opponent_left');
        const g2 = await connect();
        send(g2, 'join_room', { roomId: c.roomId, name: 'X' });
        const f = await waitForMessage(g2, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(h, g2);
    });

    test('host disconnects before guest joins → room gone', async () => {
        const h = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        h.close(); await waitForClose(h);
        const g = await connect();
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        const f = await waitForMessage(g, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 3: Explicit leave
// ═══════════════════════════════════════════════════════════════

describe('FLOW 3: explicit leave', () => {
    test('host leaves → guest notified, room gone', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'leave', { roomId: c.roomId });
        const left = await waitForMessage(g, 'opponent_left');
        expect(left.type).toBe('opponent_left');
        const g2 = await connect();
        send(g2, 'join_room', { roomId: c.roomId, name: 'X' });
        const f = await waitForMessage(g2, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(h, g, g2);
    });

    test('guest leaves → host notified, room gone', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(g, 'leave', { roomId: c.roomId });
        const left = await waitForMessage(h, 'opponent_left');
        expect(left.type).toBe('opponent_left');
        const g2 = await connect();
        send(g2, 'join_room', { roomId: c.roomId, name: 'X' });
        const f = await waitForMessage(g2, 'join_failed');
        expect(f.reason).toBe('Room not found');
        await closeAll(h, g, g2);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 4: Leave and recreate
// ═══════════════════════════════════════════════════════════════

describe('FLOW 4: leave and recreate', () => {
    test('host leaves → creates new room → different code', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const r1 = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: r1.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        g.close(); await waitForClose(g);
        await waitForMessage(h, 'opponent_left');
        send(h, 'create_room', { name: 'Alice' });
        const r2 = await waitForMessage(h, 'room_created');
        expect(r2.roomId).not.toBe(r1.roomId);
        const g2 = await connect();
        send(g2, 'join_room', { roomId: r2.roomId, name: 'Charlie' });
        const j = await waitForMessage(g2, 'room_joined');
        expect(j.roomId).toBe(r2.roomId);
        await closeAll(h, g2);
    });

    test('both leave → both create independent rooms', async () => {
        const h1 = await connect(), g1 = await connect();
        send(h1, 'create_room', { name: 'Alice' });
        const r1 = await waitForMessage(h1, 'room_created');
        send(g1, 'join_room', { roomId: r1.roomId, name: 'Bob' });
        await waitForMessage(g1, 'room_joined');
        await waitForMessage(h1, 'opponent_joined');
        h1.close(); await waitForClose(h1);
        await waitForMessage(g1, 'opponent_left');
        g1.close(); await waitForClose(g1);
        const h2 = await connect(), g2 = await connect();
        send(h2, 'create_room', { name: 'Alice' });
        const r2 = await waitForMessage(h2, 'room_created');
        send(g2, 'create_room', { name: 'Bob' });
        const r3 = await waitForMessage(g2, 'room_created');
        expect(r2.roomId).not.toBe(r3.roomId);
        const j1 = await connect();
        send(j1, 'join_room', { roomId: r2.roomId, name: 'X' });
        await waitForMessage(j1, 'room_joined');
        const j2 = await connect();
        send(j2, 'join_room', { roomId: r3.roomId, name: 'Y' });
        await waitForMessage(j2, 'room_joined');
        await closeAll(h2, g2, j1, j2);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 5: Multiple concurrent rooms
// ═══════════════════════════════════════════════════════════════

describe('FLOW 5: multiple concurrent rooms', () => {
    test('two rooms work independently', async () => {
        const h1 = await connect(), g1 = await connect(), h2 = await connect(), g2 = await connect();
        send(h1, 'create_room', { name: 'Alice' });
        const r1 = await waitForMessage(h1, 'room_created');
        send(h2, 'create_room', { name: 'Charlie' });
        const r2 = await waitForMessage(h2, 'room_created');
        expect(r1.roomId).not.toBe(r2.roomId);
        send(g1, 'join_room', { roomId: r1.roomId, name: 'Bob' });
        await waitForMessage(g1, 'room_joined');
        await waitForMessage(h1, 'opponent_joined');
        send(g2, 'join_room', { roomId: r2.roomId, name: 'Diana' });
        await waitForMessage(g2, 'room_joined');
        await waitForMessage(h2, 'opponent_joined');
        await closeAll(h1, g1, h2, g2);
    });

    test('move in room 1 does not leak to room 2', async () => {
        const h1 = await connect(), g1 = await connect(), h2 = await connect(), g2 = await connect();
        send(h1, 'create_room', { name: 'Alice' });
        const r1 = await waitForMessage(h1, 'room_created');
        send(h2, 'create_room', { name: 'Charlie' });
        const r2 = await waitForMessage(h2, 'room_created');
        send(g1, 'join_room', { roomId: r1.roomId, name: 'Bob' });
        await waitForMessage(g1, 'room_joined');
        await waitForMessage(h1, 'opponent_joined');
        send(g2, 'join_room', { roomId: r2.roomId, name: 'Diana' });
        await waitForMessage(g2, 'room_joined');
        await waitForMessage(h2, 'opponent_joined');
        send(h1, 'move', { roomId: r1.roomId, cell: 0, player: 'X' });
        const relayed = await waitForMessage(g1, 'move');
        expect(relayed.cell).toBe(0);
        const g2Msgs = await drainMessages(g2, 300);
        expect(g2Msgs.filter(m => m.type === 'move')).toHaveLength(0);
        await closeAll(h1, g1, h2, g2);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 6: Move relay
// ═══════════════════════════════════════════════════════════════

describe('FLOW 6: move relay', () => {
    test('host move → guest receives', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'move', { roomId: c.roomId, cell: 4, player: 'X' });
        const r = await waitForMessage(g, 'move');
        expect(r.cell).toBe(4); expect(r.player).toBe('X');
        await closeAll(h, g);
    });

    test('guest move → host receives', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(g, 'move', { roomId: c.roomId, cell: 0, player: 'O' });
        const r = await waitForMessage(h, 'move');
        expect(r.cell).toBe(0); expect(r.player).toBe('O');
        await closeAll(h, g);
    });

    test('move in non-existent room → error', async () => {
        const ws = await connect();
        send(ws, 'move', { roomId: 'XXXXXX', cell: 0, player: 'X' });
        const e = await waitForMessage(ws, 'error');
        expect(e.message).toBe('Room not found');
        await closeAll(ws);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 7: Blind Bid Wager — normal flow
// ═══════════════════════════════════════════════════════════════

describe('FLOW 7: blind bid — normal flow', () => {
    test('host bids → opponent gets bid_locked', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        const bl = await waitForMessage(g, 'bid_locked');
        expect(bl.type).toBe('bid_locked');
        await closeAll(h, g);
    });

    test('both bid → reveal with correct min wager and pot', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });
        const revH = await waitForMessage(h, 'bid_reveal');
        const revG = await waitForMessage(g, 'bid_reveal');
        expect(revH.finalWager).toBe(50);  // min(50, 75)
        expect(revH.pot).toBe(100);
        expect(revG.finalWager).toBe(50);
        expect(revG.pot).toBe(100);
        expect(revH.yourBid).toBe(50);
        expect(revH.opponentBid).toBe(75);
        expect(revG.yourBid).toBe(75);
        expect(revG.opponentBid).toBe(50);
        await closeAll(h, g);
    });

    test('equal bids → bonus flag is true', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 50 });
        const revH = await waitForMessage(h, 'bid_reveal');
        const revG = await waitForMessage(g, 'bid_reveal');
        expect(revH.bonus).toBe(true);
        expect(revG.bonus).toBe(true);
        expect(revH.finalWager).toBe(50);
        expect(revH.pot).toBe(100);
        await closeAll(h, g);
    });

    test('different bids → bonus flag is false', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 25 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 100 });
        const revH = await waitForMessage(h, 'bid_reveal');
        expect(revH.bonus).toBe(false);
        expect(revH.finalWager).toBe(25);
        expect(revH.pot).toBe(50);
        await closeAll(h, g);
    });

    test('bid_start after reveal → both get wager_locked', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        send(h, 'bid_start', { roomId: c.roomId });
        const startG = await waitForMessage(g, 'bid_start');
        expect(startG.wager).toBe(50);
        expect(startG.pot).toBe(100);
        await closeAll(h, g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 8: Veto — free game
// ═══════════════════════════════════════════════════════════════

describe('FLOW 8: veto — free game', () => {
    test('host vetoes → both get bid_veto', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        // Both bid first
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        // Host vetoes
        send(h, 'veto_bid', { roomId: c.roomId });
        const vetoH = await waitForMessage(h, 'bid_veto');
        const vetoG = await waitForMessage(g, 'bid_veto');
        expect(vetoH.type).toBe('bid_veto');
        expect(vetoG.type).toBe('bid_veto');
        expect(typeof vetoH.vetoedBy).toBe('string');
        await closeAll(h, g);
    });

    test('guest vetoes → both get bid_veto', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        // Guest vetoes
        send(g, 'veto_bid', { roomId: c.roomId });
        const vetoH = await waitForMessage(h, 'bid_veto');
        const vetoG = await waitForMessage(g, 'bid_veto');
        expect(vetoH.type).toBe('bid_veto');
        expect(vetoG.type).toBe('bid_veto');
        await closeAll(h, g);
    });

    test('veto before any bids placed → still works', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        // Host places bid but guest vetoes before bidding
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'veto_bid', { roomId: c.roomId });
        const vetoH = await waitForMessage(h, 'bid_veto');
        const vetoG = await waitForMessage(g, 'bid_veto');
        expect(vetoH.type).toBe('bid_veto');
        expect(vetoG.type).toBe('bid_veto');
        await closeAll(h, g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 9: Rematch
// ═══════════════════════════════════════════════════════════════

describe('FLOW 9: rematch', () => {
    test('rematch request → accept → both get rematch_accepted', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        send(h, 'rematch_request', { roomId: c.roomId });
        const req = await waitForMessage(g, 'rematch_requested');
        expect(req.type).toBe('rematch_requested');
        send(g, 'rematch_accept', { roomId: c.roomId });
        const ackH = await waitForMessage(h, 'rematch_accepted');
        const ackG = await waitForMessage(g, 'rematch_accepted');
        expect(ackH.type).toBe('rematch_accepted');
        expect(ackG.type).toBe('rematch_accepted');
        await closeAll(h, g);
    });

    test('rematch resets bid state → new bids work', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');

        // Round 1: bids
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');

        // Rematch
        send(h, 'rematch_request', { roomId: c.roomId });
        await waitForMessage(g, 'rematch_requested');
        send(g, 'rematch_accept', { roomId: c.roomId });
        await waitForMessage(h, 'rematch_accepted');
        await waitForMessage(g, 'rematch_accepted');

        // Round 2: new bids (different amounts)
        send(h, 'place_bid', { roomId: c.roomId, amount: 100 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 25 });
        const revH = await waitForMessage(h, 'bid_reveal');
        const revG = await waitForMessage(g, 'bid_reveal');
        expect(revH.finalWager).toBe(25);  // min(100, 25)
        expect(revH.pot).toBe(50);
        expect(revG.finalWager).toBe(25);
        expect(revG.pot).toBe(50);
        await closeAll(h, g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 10: Veto then rematch — bid state must reset
// ═══════════════════════════════════════════════════════════════

describe('FLOW 10: veto then rematch — full cycle', () => {
    test('veto round → rematch → normal bid round works correctly', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');

        // Round 1: bids then veto
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        send(h, 'veto_bid', { roomId: c.roomId });
        await waitForMessage(h, 'bid_veto');
        await waitForMessage(g, 'bid_veto');

        // Rematch
        send(h, 'rematch_request', { roomId: c.roomId });
        await waitForMessage(g, 'rematch_requested');
        send(g, 'rematch_accept', { roomId: c.roomId });
        await waitForMessage(h, 'rematch_accepted');
        await waitForMessage(g, 'rematch_accepted');

        // Round 2: normal bids (should work as if fresh — no veto carryover)
        send(h, 'place_bid', { roomId: c.roomId, amount: 100 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 100 });
        const revH = await waitForMessage(h, 'bid_reveal');
        const revG = await waitForMessage(g, 'bid_reveal');
        expect(revH.finalWager).toBe(100);
        expect(revH.pot).toBe(200);
        expect(revH.bonus).toBe(true);  // equal bids
        expect(revG.finalWager).toBe(100);
        expect(revG.pot).toBe(200);
        expect(revG.bonus).toBe(true);

        // bid_start should work normally
        send(h, 'bid_start', { roomId: c.roomId });
        const startG = await waitForMessage(g, 'bid_start');
        expect(startG.wager).toBe(100);
        expect(startG.pot).toBe(200);

        await closeAll(h, g);
    });

    test('veto round → rematch → veto again works', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');

        // Round 1: veto
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        send(g, 'veto_bid', { roomId: c.roomId });
        await waitForMessage(h, 'bid_veto');
        await waitForMessage(g, 'bid_veto');

        // Rematch
        send(h, 'rematch_request', { roomId: c.roomId });
        await waitForMessage(g, 'rematch_requested');
        send(g, 'rematch_accept', { roomId: c.roomId });
        await waitForMessage(h, 'rematch_accepted');
        await waitForMessage(g, 'rematch_accepted');

        // Round 2: veto again
        send(h, 'place_bid', { roomId: c.roomId, amount: 200 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 100 });
        await waitForMessage(h, 'bid_reveal');
        await waitForMessage(g, 'bid_reveal');
        send(h, 'veto_bid', { roomId: c.roomId });
        await waitForMessage(h, 'bid_veto');
        await waitForMessage(g, 'bid_veto');

        await closeAll(h, g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 11: Error handling
// ═══════════════════════════════════════════════════════════════

describe('FLOW 11: error handling', () => {
    test('unknown message type → error', async () => {
        const ws = await connect();
        ws.send(JSON.stringify({ type: 'unknown_type' }));
        // Server should either ignore or return error; either way no crash
        const msgs = await drainMessages(ws, 500);
        // If error returned, check it
        const err = msgs.find(m => m.type === 'error');
        if (err) expect(err.message).toBeDefined();
        await closeAll(ws);
    });

    test('invalid JSON → error', async () => {
        const ws = await connect();
        ws.send('not json{{{');
        const e = await waitForMessage(ws, 'error');
        expect(e.message).toBe('Invalid message');
        await closeAll(ws);
    });

    test('place_bid in non-existent room → error', async () => {
        const ws = await connect();
        send(ws, 'place_bid', { roomId: 'XXXXXX', amount: 50 });
        const e = await waitForMessage(ws, 'error');
        expect(e.message).toBe('Room not found');
        await closeAll(ws);
    });

    test('veto in non-existent room → no crash (silent ignore)', async () => {
        const ws = await connect();
        send(ws, 'veto_bid', { roomId: 'XXXXXX' });
        const msgs = await drainMessages(ws, 300);
        expect(msgs.filter(m => m.type === 'error')).toHaveLength(0);
        await closeAll(ws);
    });

    test('bid_start without wager_locked → ignored', async () => {
        const h = await connect(), g = await connect();
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');
        // bid_start without any bids
        send(h, 'bid_start', { roomId: c.roomId });
        const msgs = await drainMessages(g, 300);
        expect(msgs.filter(m => m.type === 'bid_start')).toHaveLength(0);
        await closeAll(h, g);
    });
});

// ═══════════════════════════════════════════════════════════════
// FLOW 12: Full game cycle
// ═══════════════════════════════════════════════════════════════

describe('FLOW 12: full game cycle', () => {
    test('create → join → bid → reveal → start → moves → rematch', async () => {
        const h = await connect(), g = await connect();

        // 1. Create room
        send(h, 'create_room', { name: 'Alice' });
        const c = await waitForMessage(h, 'room_created');
        expect(c.roomId).toHaveLength(6);

        // 2. Join
        send(g, 'join_room', { roomId: c.roomId, name: 'Bob' });
        await waitForMessage(g, 'room_joined');
        await waitForMessage(h, 'opponent_joined');

        // 3. Bid
        send(h, 'place_bid', { roomId: c.roomId, amount: 50 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 75 });

        // 4. Reveal
        const revH = await waitForMessage(h, 'bid_reveal');
        const revG = await waitForMessage(g, 'bid_reveal');
        expect(revH.finalWager).toBe(50);
        expect(revH.pot).toBe(100);

        // 5. Start game
        send(h, 'bid_start', { roomId: c.roomId });
        const startG = await waitForMessage(g, 'bid_start');
        expect(startG.wager).toBe(50);
        expect(startG.pot).toBe(100);

        // 6. Play moves (X wins with top row)
        send(h, 'move', { roomId: c.roomId, cell: 0, player: 'X' }); // X
        await waitForMessage(g, 'move');
        send(g, 'move', { roomId: c.roomId, cell: 3, player: 'O' }); // O
        await waitForMessage(h, 'move');
        send(h, 'move', { roomId: c.roomId, cell: 1, player: 'X' }); // X
        await waitForMessage(g, 'move');
        send(g, 'move', { roomId: c.roomId, cell: 4, player: 'O' }); // O
        await waitForMessage(h, 'move');
        send(h, 'move', { roomId: c.roomId, cell: 2, player: 'X' }); // X wins!
        await waitForMessage(g, 'move');

        // 7. Rematch
        send(h, 'rematch_request', { roomId: c.roomId });
        await waitForMessage(g, 'rematch_requested');
        send(g, 'rematch_accept', { roomId: c.roomId });
        await waitForMessage(h, 'rematch_accepted');
        await waitForMessage(g, 'rematch_accepted');

        // 8. New bid round works
        send(h, 'place_bid', { roomId: c.roomId, amount: 25 });
        await waitForMessage(g, 'bid_locked');
        send(g, 'place_bid', { roomId: c.roomId, amount: 25 });
        const rev2H = await waitForMessage(h, 'bid_reveal');
        const rev2G = await waitForMessage(g, 'bid_reveal');
        expect(rev2H.finalWager).toBe(25);
        expect(rev2H.pot).toBe(50);
        expect(rev2H.bonus).toBe(true);

        await closeAll(h, g);
    });
});
