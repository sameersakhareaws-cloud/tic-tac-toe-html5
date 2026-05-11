const WebSocket = require('ws');
const http = require('http');

let httpServer;
let PORT;

function getPort() {
    // Use a random port to avoid conflicts from previous test runs
    return Math.floor(Math.random() * 10000) + 20000;
}

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
                try {
                    const msg = JSON.parse(raw);
                    handleMessage(playerId, msg);
                } catch (e) {
                    sendTo(ws, 'error', { message: 'Invalid message' });
                }
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
                    rooms.set(roomId, {
                        hostName: msg.name || 'Host',
                        hostId: playerId,
                        guestName: null,
                        guestId: null,
                        createdAt: Date.now(),
                        hostBid: undefined,
                        guestBid: undefined,
                        wager: 0,
                        wagerLocked: false
                    });
                    player.roomId = roomId;
                    player.name = msg.name || 'Host';
                    sendTo(player.ws, 'room_created', { roomId });
                    break;
                }
                case 'join_room': {
                    const roomId = msg.roomId.toUpperCase();
                    const room = rooms.get(roomId);
                    if (!room || !room.hostId) {
                        sendTo(player.ws, 'join_failed', { reason: 'Room not found' });
                        break;
                    }
                    if (room.guestId) {
                        sendTo(player.ws, 'join_failed', { reason: 'Room is full' });
                        break;
                    }
                    room.guestName = msg.name || 'Guest';
                    room.guestId = playerId;
                    player.roomId = roomId;
                    player.name = msg.name || 'Guest';
                    sendTo(player.ws, 'room_joined', { roomId, symbol: 'O', hostName: room.hostName });
                    if (room.hostId) {
                        sendToPlayer(room.hostId, 'opponent_joined', { name: player.name, symbol: 'O' });
                    }
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
                    room.hostBid = undefined;
                    room.guestBid = undefined;
                    room.wager = 0;
                    room.wagerLocked = false;
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
                        room.wager = finalWager;
                        room.wagerLocked = true;
                        if (room.hostId) sendToPlayer(room.hostId, 'bid_reveal', {
                            yourBid: room.hostBid, opponentBid: room.guestBid, finalWager, pot, bonus
                        });
                        if (room.guestId) sendToPlayer(room.guestId, 'bid_reveal', {
                            yourBid: room.guestBid, opponentBid: room.hostId === playerId ? room.hostBid : room.guestBid, finalWager, pot, bonus
                        });
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
                    const startData = { wager: room.wager, pot: room.wager * 2 };
                    if (room.hostId) sendToPlayer(room.hostId, 'bid_start', startData);
                    if (room.guestId) sendToPlayer(room.guestId, 'bid_start', startData);
                    break;
                }
                case 'leave': {
                    const opponentId = handlePlayerLeave(playerId);
                    if (opponentId) sendToPlayer(opponentId, 'opponent_left');
                    break;
                }
            }
        }

        httpServer.listen(PORT, () => {
            resolve(`ws://localhost:${PORT}`);
        });
    });
}

function stopServer() {
    return new Promise((resolve) => {
        if (httpServer) {
            // Close all existing connections first
            httpServer.close(() => {
                httpServer = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        const timer = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

function send(ws, type, data = {}) {
    ws.send(JSON.stringify({ type, ...data }));
}

function waitForMessage(ws, type, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === type) {
                    clearTimeout(timer);
                    ws.off('message', handler);
                    resolve(msg);
                }
            } catch (e) {}
        };
        ws.on('message', handler);
    });
}

function waitForClose(ws, timeout = 8000) {
    return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeout);
        ws.on('close', () => { clearTimeout(timer); resolve(); });
    });
}

async function closeAll(...sockets) {
    for (const s of sockets) {
        try { if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) s.close(); } catch (e) {}
    }
    for (const s of sockets) {
        try { await waitForClose(s, 3000); } catch (e) {}
    }
}

beforeAll(async () => { await startServer(); }, 10000);
afterAll(async () => { await stopServer(); }, 10000);
afterEach(async () => { await new Promise(r => setTimeout(r, 100)); });

// ===== E2E: Room Creation & Joining =====

describe('E2E: room creation and joining', () => {
    test('host creates room, guest joins successfully', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');
        expect(created.roomId).toBeDefined();
        expect(created.roomId).toHaveLength(6);

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        const joined = await waitForMessage(guest, 'room_joined');
        expect(joined.roomId).toBe(created.roomId);
        expect(joined.symbol).toBe('O');
        expect(joined.hostName).toBe('Alice');

        const opponentJoined = await waitForMessage(host, 'opponent_joined');
        expect(opponentJoined.name).toBe('Bob');

        await closeAll(host, guest);
    });

    test('guest cannot join non-existent room', async () => {
        const guest = await connect();
        send(guest, 'join_room', { roomId: 'XXXXXX', name: 'Bob' });
        const failed = await waitForMessage(guest, 'join_failed');
        expect(failed.reason).toBe('Room not found');
        await closeAll(guest);
    });

    test('guest cannot join a full room', async () => {
        const host = await connect();
        const guest1 = await connect();
        const guest2 = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest1, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest1, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(guest2, 'join_room', { roomId: created.roomId, name: 'Charlie' });
        const failed = await waitForMessage(guest2, 'join_failed');
        expect(failed.reason).toBe('Room is full');

        await closeAll(host, guest1, guest2);
    });
});

// ===== E2E: Disconnect — room destroyed immediately =====

describe('E2E: disconnect destroys room', () => {
    test('host disconnects — guest gets opponent_left, room destroyed', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        host.close();
        await waitForClose(host);

        const left = await waitForMessage(guest, 'opponent_left');
        expect(left.type).toBe('opponent_left');

        // Room destroyed — new guest cannot join
        const guest2 = await connect();
        send(guest2, 'join_room', { roomId: created.roomId, name: 'Charlie' });
        const failed = await waitForMessage(guest2, 'join_failed');
        expect(failed.reason).toBe('Room not found');

        await closeAll(guest, guest2);
    });

    test('guest disconnects — host gets opponent_left, room destroyed', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        guest.close();
        await waitForClose(guest);

        const left = await waitForMessage(host, 'opponent_left');
        expect(left.type).toBe('opponent_left');

        // Room destroyed — new guest cannot join
        const guest2 = await connect();
        send(guest2, 'join_room', { roomId: created.roomId, name: 'Charlie' });
        const failed = await waitForMessage(guest2, 'join_failed');
        expect(failed.reason).toBe('Room not found');

        await closeAll(host, guest2);
    });
});

// ===== E2E: Explicit leave =====

describe('E2E: explicit leave message', () => {
    test('host sends leave — guest notified, room destroyed', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'leave', { roomId: created.roomId });

        const left = await waitForMessage(guest, 'opponent_left');
        expect(left.type).toBe('opponent_left');

        // Room destroyed
        const guest2 = await connect();
        send(guest2, 'join_room', { roomId: created.roomId, name: 'Charlie' });
        const failed = await waitForMessage(guest2, 'join_failed');
        expect(failed.reason).toBe('Room not found');

        await closeAll(host, guest, guest2);
    });
});

// ===== E2E: Leave and recreate =====

describe('E2E: leave and recreate', () => {
    test('host leaves room, creates new room — gets new code', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const room1 = await waitForMessage(host, 'room_created');
        send(guest, 'join_room', { roomId: room1.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        // Guest leaves — room destroyed
        guest.close();
        await waitForClose(guest);
        await waitForMessage(host, 'opponent_left');

        // Host creates new room
        send(host, 'create_room', { name: 'Alice' });
        const room2 = await waitForMessage(host, 'room_created');
        expect(room2.roomId).not.toBe(room1.roomId);

        // New guest can join the new room
        const guest2 = await connect();
        send(guest2, 'join_room', { roomId: room2.roomId, name: 'Charlie' });
        const joined = await waitForMessage(guest2, 'room_joined');
        expect(joined.roomId).toBe(room2.roomId);

        await closeAll(host, guest2);
    });

    test('both leave and create independent new rooms', async () => {
        const host1 = await connect();
        const guest1 = await connect();

        send(host1, 'create_room', { name: 'Alice' });
        const room1 = await waitForMessage(host1, 'room_created');
        send(guest1, 'join_room', { roomId: room1.roomId, name: 'Bob' });
        await waitForMessage(guest1, 'room_joined');
        await waitForMessage(host1, 'opponent_joined');

        // Both leave
        host1.close();
        await waitForClose(host1);
        await waitForMessage(guest1, 'opponent_left');
        guest1.close();
        await waitForClose(guest1);

        // Both create new rooms
        const host2 = await connect();
        const guest2 = await connect();

        send(host2, 'create_room', { name: 'Alice' });
        const room2 = await waitForMessage(host2, 'room_created');

        send(guest2, 'create_room', { name: 'Bob' });
        const room3 = await waitForMessage(guest2, 'room_created');

        expect(room2.roomId).not.toBe(room3.roomId);

        const joiner1 = await connect();
        send(joiner1, 'join_room', { roomId: room2.roomId, name: 'X' });
        await waitForMessage(joiner1, 'room_joined');

        const joiner2 = await connect();
        send(joiner2, 'join_room', { roomId: room3.roomId, name: 'Y' });
        await waitForMessage(joiner2, 'room_joined');

        await closeAll(host2, guest2, joiner1, joiner2);
    });
});

// ===== E2E: Multiple rooms =====

describe('E2E: multiple concurrent rooms', () => {
    test('two independent rooms work simultaneously', async () => {
        const h1 = await connect();
        const g1 = await connect();
        const h2 = await connect();
        const g2 = await connect();

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
});

// ===== E2E: Moves =====

describe('E2E: move relay', () => {
    test('moves are relayed between host and guest', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'move', { roomId: created.roomId, cell: 4, player: 'X' });
        const relayed = await waitForMessage(guest, 'move');
        expect(relayed.cell).toBe(4);
        expect(relayed.player).toBe('X');

        await closeAll(host, guest);
    });
});

// ===== E2E: Rematch =====

describe('E2E: rematch flow', () => {
    test('rematch request and accept', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'rematch_request', { roomId: created.roomId });
        await waitForMessage(guest, 'rematch_requested');

        send(guest, 'rematch_accept', { roomId: created.roomId });

        await waitForMessage(host, 'rematch_accepted');
        await waitForMessage(guest, 'rematch_accepted');

        await closeAll(host, guest);
    });
});

// ===== E2E: Blind Bid Wager =====

describe('E2E: blind bid wager', () => {
    test('both players place bids, reveal happens', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'place_bid', { roomId: created.roomId, amount: 50 });
        await waitForMessage(guest, 'bid_locked');

        send(guest, 'place_bid', { roomId: created.roomId, amount: 75 });

        const reveal1 = await waitForMessage(host, 'bid_reveal');
        const reveal2 = await waitForMessage(guest, 'bid_reveal');
        expect(reveal1.finalWager).toBe(50);
        expect(reveal1.pot).toBe(100);
        expect(reveal2.finalWager).toBe(50);
        expect(reveal2.pot).toBe(100);

        await closeAll(host, guest);
    });

    test('veto bid — both get bid_veto', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'place_bid', { roomId: created.roomId, amount: 50 });
        await waitForMessage(guest, 'bid_locked');

        send(guest, 'veto_bid', { roomId: created.roomId });

        await waitForMessage(host, 'bid_veto');
        await waitForMessage(guest, 'bid_veto');

        await closeAll(host, guest);
    });

    test('bid_start after reveal', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        send(host, 'place_bid', { roomId: created.roomId, amount: 50 });
        await waitForMessage(guest, 'bid_locked');
        send(guest, 'place_bid', { roomId: created.roomId, amount: 50 });
        await waitForMessage(host, 'bid_reveal');
        await waitForMessage(guest, 'bid_reveal');

        send(host, 'bid_start', { roomId: created.roomId });
        const start = await waitForMessage(guest, 'bid_start');
        expect(start.wager).toBe(50);
        expect(start.pot).toBe(100);

        await closeAll(host, guest);
    });
});

// ===== E2E: Rematch with bid reset =====

describe('E2E: rematch resets bid state', () => {
    test('after rematch accept, new bids work correctly', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');
        await waitForMessage(host, 'opponent_joined');

        // First round bids
        send(host, 'place_bid', { roomId: created.roomId, amount: 50 });
        await waitForMessage(guest, 'bid_locked');
        send(guest, 'place_bid', { roomId: created.roomId, amount: 75 });
        await waitForMessage(host, 'bid_reveal');
        await waitForMessage(guest, 'bid_reveal');

        // Rematch
        send(host, 'rematch_request', { roomId: created.roomId });
        await waitForMessage(guest, 'rematch_requested');
        send(guest, 'rematch_accept', { roomId: created.roomId });
        await waitForMessage(host, 'rematch_accepted');
        await waitForMessage(guest, 'rematch_accepted');

        // Second round bids
        send(host, 'place_bid', { roomId: created.roomId, amount: 100 });
        await waitForMessage(guest, 'bid_locked');
        send(guest, 'place_bid', { roomId: created.roomId, amount: 25 });

        const reveal1 = await waitForMessage(host, 'bid_reveal');
        const reveal2 = await waitForMessage(guest, 'bid_reveal');
        expect(reveal1.finalWager).toBe(25);
        expect(reveal1.pot).toBe(50);
        expect(reveal2.finalWager).toBe(25);
        expect(reveal2.pot).toBe(50);

        await closeAll(host, guest);
    });
});
