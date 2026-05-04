/**
 * Tic-Tac-Toe WebSocket Server
 * Simple room management and message relay
 *
 * Deploy to Render/Railway/Heroku:
 *   npm install
 *   node server/server.js
 */
const WebSocket = require('ws');
const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

// ===== Room Management =====
const rooms = new Map(); // roomId -> { host, hostId, guest, guestId, createdAt }

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

function createRoom(hostId, hostName) {
    const roomId = generateRoomCode();
    rooms.set(roomId, {
        host: hostName || 'Host',
        hostId,
        guest: null,
        guestId: null,
        createdAt: Date.now()
    });
    return roomId;
}

function joinRoom(roomId, guestId, guestName) {
    const room = rooms.get(roomId);
    if (!room) return { success: false, reason: 'Room not found' };
    if (room.guestId) return { success: false, reason: 'Room is full' };
    if (room.hostId === guestId) return { success: false, reason: 'Cannot join your own room' };

    room.guest = guestName || 'Guest';
    room.guestId = guestId;
    return { success: true, room };
}

function leaveRoom(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) return null;

    let opponentId = null;
    if (room.hostId === playerId) {
        // Host leaves — notify guest
        opponentId = room.guestId;
        rooms.delete(roomId);
    } else if (room.guestId === playerId) {
        // Guest leaves — keep room, notify host
        opponentId = room.hostId;
        room.guest = null;
        room.guestId = null;
    }
    return opponentId;
}

function deleteRoom(roomId) {
    rooms.delete(roomId);
}

// Clean up old rooms (older than 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
        if (now - room.createdAt > 3600000) {
            rooms.delete(id);
        }
    }
}, 60000);

// ===== WebSocket Server =====
const server = http.createServer((req, res) => {
    // Simple health check / info endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'ok',
        rooms: rooms.size,
        uptime: process.uptime()
    }));
});

const wss = new WebSocket.Server({ server });

function sendMessage(ws, type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function broadcast(roomId, data, excludeId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client._playerId !== excludeId) {
            if (client._roomId === roomId) {
                sendMessage(client, data.type, data);
            }
        }
    });
}

wss.on('connection', (ws, req) => {
    const playerId = generatePlayerId();
    ws._playerId = playerId;
    ws._roomId = null;
    ws._name = 'Player';

    console.log(`Player connected: ${playerId}`);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleMessage(ws, msg);
        } catch (e) {
            console.error('Invalid message:', e);
            sendMessage(ws, 'error', { message: 'Invalid message format' });
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);
        if (ws._roomId) {
            const opponentId = leaveRoom(ws._roomId, playerId);
            if (opponentId) {
                // Notify opponent
                wss.clients.forEach(client => {
                    if (client._playerId === opponentId && client.readyState === WebSocket.OPEN) {
                        sendMessage(client, 'opponent_left');
                    }
                });
            }
        }
    });

    ws.on('error', (e) => {
        console.error(`WS error for ${playerId}:`, e.message);
    });
});

function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'create_room': {
            const roomId = createRoom(ws._playerId, msg.name);
            ws._roomId = roomId;
            ws._name = msg.name || 'Host';
            sendMessage(ws, 'room_created', { roomId });
            console.log(`Room created: ${roomId} by ${ws._playerId}`);
            break;
        }

        case 'join_room': {
            const roomId = msg.roomId.toUpperCase();
            const result = joinRoom(roomId, ws._playerId, msg.name);

            if (result.success) {
                ws._roomId = roomId;
                ws._name = msg.name || 'Guest';

                sendMessage(ws, 'room_joined', {
                    roomId,
                    symbol: 'O',
                    hostName: result.room.host
                });

                // Notify host
                wss.clients.forEach(client => {
                    if (client._playerId === result.room.hostId && client.readyState === WebSocket.OPEN) {
                        sendMessage(client, 'opponent_joined', {
                            name: ws._name,
                            symbol: 'O'
                        });
                    }
                });

                console.log(`Player ${ws._playerId} joined room ${roomId}`);
            } else {
                sendMessage(ws, 'join_failed', { reason: result.reason });
            }
            break;
        }

        case 'move': {
            if (ws._roomId) {
                broadcast(ws._roomId, {
                    type: 'move',
                    cell: msg.cell,
                    player: msg.player
                }, ws._playerId);
            }
            break;
        }

        case 'rematch_request': {
            if (ws._roomId) {
                broadcast(ws._roomId, { type: 'rematch_requested' }, ws._playerId);
            }
            break;
        }

        case 'rematch_accept': {
            if (ws._roomId) {
                broadcast(ws._roomId, { type: 'rematch_accepted' }, ws._playerId);
            }
            break;
        }

        case 'leave': {
            if (ws._roomId) {
                const opponentId = leaveRoom(ws._roomId, ws._playerId);
                if (opponentId) {
                    wss.clients.forEach(client => {
                        if (client._playerId === opponentId && client.readyState === WebSocket.OPEN) {
                            sendMessage(client, 'opponent_left');
                        }
                    });
                }
                ws._roomId = null;
            }
            break;
        }

        default:
            sendMessage(ws, 'error', { message: `Unknown message type: ${msg.type}` });
    }
}

function generatePlayerId() {
    return 'p_' + Math.random().toString(36).substring(2, 10);
}

// ===== Start =====
server.listen(PORT, () => {
    console.log(`Tic-Tac-Toe WebSocket server running on port ${PORT}`);
});
