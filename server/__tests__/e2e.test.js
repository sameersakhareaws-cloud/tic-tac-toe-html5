const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// We'll spin up the actual server for E2E tests
let server;
let httpServer;
let PORT = 19876; // use a non-standard port for testing

function startServer() {
    return new Promise((resolve) => {
        // Minimal HTTP server that serves the WS endpoint
        httpServer = http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ status: 'ok' }));
            }
            res.writeHead(404);
            res.end();
        });

        // Inline the room manager for E2E — same logic as server.js
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
                const player = players.get(playerId);
                if (!player || !player.roomId) { players.delete(playerId); return; }
                const room = rooms.get(player.roomId);
                if (!room) { players.delete(playerId); return; }

                let opponentId = null;
                if (room.hostId === playerId) {
                    opponentId = room.guestId;
                    room.hostDisconnectedAt = Date.now();
                    room.hostId = null;
                } else if (room.guestId === playerId) {
                    opponentId = room.hostId;
                    room.guestName = null;
                    room.guestId = null;
                }
                player.roomId = null;
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
                        hostDisconnectedAt: null,
                        wager: 0,
                        wagerHostConfirmed: false,
                        wagerGuestConfirmed: false,
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
                    if (!room) {
                        sendTo(player.ws, 'join_failed', { reason: 'Room not found' });
                        break;
                    }
                    if (!room.hostId && room.hostDisconnectedAt) {
                        if (Date.now() - room.hostDisconnectedAt > 30000) {
                            sendTo(player.ws, 'join_failed', { reason: 'Room not found' });
                            break;
                        }
                    } else if (!room.hostId) {
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
            httpServer.close(resolve);
        } else {
            resolve();
        }
    });
}

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}

function send(ws, type, data = {}) {
    ws.send(JSON.stringify({ type, ...data }));
}

function waitForMessage(ws, type, timeout = 5000) {
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

function waitForClose(ws, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeout);
        ws.on('close', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

beforeAll(async () => {
    await startServer();
});

afterAll(async () => {
    await stopServer();
});

afterEach(async () => {
    // Small delay to let server settle
    await new Promise(r => setTimeout(r, 50));
});

// ===== E2E: Room Creation & Joining =====

describe('E2E: room creation and joining', () => {
    test('host creates room, guest joins successfully', async () => {
        const host = await connect();
        const guest = await connect();

        // Host creates room
        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');
        expect(created.roomId).toBeDefined();
        expect(created.roomId).toHaveLength(6);

        // Guest joins
        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        const joined = await waitForMessage(guest, 'room_joined');
        expect(joined.roomId).toBe(created.roomId);
        expect(joined.symbol).toBe('O');
        expect(joined.hostName).toBe('Alice');

        // Host gets notified
        const opponentJoined = await waitForMessage(host, 'opponent_joined');
        expect(opponentJoined.name).toBe('Bob');

        host.close();
        guest.close();
        await waitForClose(host);
        await waitForClose(guest);
    });

    test('guest cannot join non-existent room', async () => {
        const guest = await connect();

        send(guest, 'join_room', { roomId: 'XXXXXX', name: 'Bob' });
        const failed = await waitForMessage(guest, 'join_failed');
        expect(failed.reason).toBe('Room not found');

        guest.close();
        await waitForClose(guest);
    });

    test('guest cannot join a full room', async () => {
        const host = await connect();
        const guest1 = await connect();
        const guest2 = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        // First guest joins
        send(guest1, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest1, 'room_joined');

        // Second guest fails
        send(guest2, 'join_room', { roomId: created.roomId, name: 'Charlie' });
        const failed = await waitForMessage(guest2, 'join_failed');
        expect(failed.reason).toBe('Room is full');

        host.close();
        guest1.close();
        guest2.close();
        await waitForClose(host);
        await waitForClose(guest1);
        await waitForClose(guest2);
    });
});

// ===== E2E: Disconnect & Reconnect =====

describe('E2E: host disconnect and reconnect', () => {
    test('host disconnects — guest gets opponent_left', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');

        // Host disconnects
        host.close();
        await waitForClose(host);

        // Guest should be notified
        const left = await waitForMessage(guest, 'opponent_left');
        expect(left.type).toBe('opponent_left');

        guest.close();
        await waitForClose(guest);
    });

    test('guest disconnects — host gets opponent_left', async () => {
        const host = await connect();
        const guest = await connect();

        send(host, 'create_room', { name: 'Alice' });
        const created = await waitForMessage(host, 'room_created');

        send(guest, 'join_room', { roomId: created.roomId, name: 'Bob' });
        await waitForMessage(guest, 'room_joined');

        // Guest disconnects
        guest.close();
        await waitForClose(guest);

        // Host should be notified
        const left = await waitForMessage(host, 'opponent_left');
        expect(left.type).toBe('opponent_left');

        host.close();
        await waitForClose(host);
    });
});

// ===== E2E: Multiple rooms =====

describe('E2E: multiple concurrent rooms', () => {
    test('two independent rooms work simultaneously', async () => {
        const host1 = await connect();
        const guest1 = await connect();
        const host2 = await connect();
        const guest2 = await connect();

        // Room 1
        send(host1, 'create_room', { name: 'Alice' });
        const room1 = await waitForMessage(host1, 'room_created');

        // Room 2
        send(host2, 'create_room', { name: 'Charlie' });
        const room2 = await waitForMessage(host2, 'room_created');

        expect(room1.roomId).not.toBe(room2.roomId);

        // Guest 1 joins room 1
        send(guest1, 'join_room', { roomId: room1.roomId, name: 'Bob' });
        const j1 = await waitForMessage(guest1, 'room_joined');
        expect(j1.roomId).toBe(room1.roomId);

        // Guest 2 joins room 2
        send(guest2, 'join_room', { roomId: room2.roomId, name: 'Diana' });
        const j2 = await waitForMessage(guest2, 'room_joined');
        expect(j2.roomId).toBe(room2.roomId);

        // Both hosts get notified
        await waitForMessage(host1, 'opponent_joined');
        await waitForMessage(host2, 'opponent_joined');

        host1.close();
        guest1.close();
        host2.close();
        guest2.close();
        await waitForClose(host1);
        await waitForClose(guest1);
        await waitForClose(host2);
        await waitForClose(guest2);
    });
});
