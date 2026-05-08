/**
 * Tic-Tac-Toe WebSocket Server
 * Simple room management and message relay
 *
 * Deploy to Render/Railway:
 *   npm install
 *   node server/server.js
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ===== Room Management =====
// roomId -> { hostName, hostId, guestName, guestId, createdAt }
const rooms = new Map();

// playerId -> { ws, roomId, name }
const players = new Map();

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
        hostName: hostName || 'Host',
        hostId,
        guestName: null,
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

    room.guestName = guestName || 'Guest';
    room.guestId = guestId;
    return { success: true, room };
}

/**
 * Handle a player leaving. Returns the opponent's playerId (if any) for notification.
 * If host leaves, the room is destroyed. If guest leaves, the room stays.
 */
function handlePlayerLeave(playerId) {
    const player = players.get(playerId);
    if (!player || !player.roomId) return null;

    const roomId = player.roomId;
    const room = rooms.get(roomId);
    if (!room) return null;

    let opponentId = null;

    if (room.hostId === playerId) {
        // Host leaves — destroy room, notify guest
        opponentId = room.guestId;
        rooms.delete(roomId);
    } else if (room.guestId === playerId) {
        // Guest leaves — keep room, notify host
        opponentId = room.hostId;
        room.guestName = null;
        room.guestId = null;
    }

    player.roomId = null;
    return opponentId;
}

// Clean up rooms older than 1 hour
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
        if (now - room.createdAt > 3600000) {
            rooms.delete(id);
        }
    }
}, 60000);

// ===== HTTP + WebSocket Server =====
const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    // Health check
    if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'ok',
            rooms: rooms.size,
            players: players.size,
            uptime: Math.round(process.uptime())
        }));
    }

    // Static file serving
    const publicDir = path.join(__dirname, '..');
    let filePath = path.join(publicDir, url === '/' ? 'index.html' : url);
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            // Fallback to index.html for unknown routes
            fs.readFile(path.join(publicDir, 'index.html'), (err2, data2) => {
                if (err2) {
                    res.writeHead(404);
                    res.end('Not found');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data2);
                }
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

function sendTo(ws, type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function sendToPlayer(playerId, type, data = {}) {
    const player = players.get(playerId);
    if (player) {
        sendTo(player.ws, type, data);
    }
}

wss.on('connection', (ws) => {
    const playerId = 'p_' + Math.random().toString(36).substring(2, 10);
    players.set(playerId, { ws, roomId: null, name: 'Player' });

    console.log(`Connected: ${playerId} (total: ${players.size})`);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            handleMessage(playerId, msg);
        } catch (e) {
            console.error('Invalid message from', playerId, e.message);
            sendTo(ws, 'error', { message: 'Invalid message format' });
        }
    });

    ws.on('close', () => {
        console.log(`Disconnected: ${playerId}`);
        const opponentId = handlePlayerLeave(playerId);
        if (opponentId) {
            sendToPlayer(opponentId, 'opponent_left');
        }
        players.delete(playerId);
    });

    ws.on('error', (e) => {
        console.error(`WS error for ${playerId}:`, e.message);
    });
});

function handleMessage(playerId, msg) {
    const player = players.get(playerId);
    if (!player) return;

    switch (msg.type) {
        case 'create_room': {
            const roomId = createRoom(playerId, msg.name);
            player.roomId = roomId;
            player.name = msg.name || 'Host';
            sendTo(player.ws, 'room_created', { roomId });
            console.log(`Room ${roomId} created by ${playerId}`);
            break;
        }

        case 'join_room': {
            const roomId = msg.roomId.toUpperCase();
            const result = joinRoom(roomId, playerId, msg.name);

            if (result.success) {
                player.roomId = roomId;
                player.name = msg.name || 'Guest';

                sendTo(player.ws, 'room_joined', {
                    roomId,
                    symbol: 'O',
                    hostName: result.room.hostName
                });

                // Notify host
                sendToPlayer(result.room.hostId, 'opponent_joined', {
                    name: player.name,
                    symbol: 'O'
                });

                console.log(`${playerId} joined room ${roomId}`);
            } else {
                sendTo(player.ws, 'join_failed', { reason: result.reason });
            }
            break;
        }

        case 'move': {
            const room = rooms.get(msg.roomId);
            if (!room) {
                sendTo(player.ws, 'error', { message: 'Room not found' });
                return;
            }
            // Relay move to the other player in the room
            const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
            if (opponentId) {
                sendToPlayer(opponentId, 'move', {
                    cell: msg.cell,
                    player: msg.player
                });
            }
            break;
        }

        case 'rematch_request': {
            const room = rooms.get(msg.roomId);
            if (!room) return;
            const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
            if (opponentId) {
                sendToPlayer(opponentId, 'rematch_requested');
            }
            break;
        }

        case 'rematch_accept': {
            const room = rooms.get(msg.roomId);
            if (!room) return;
            // Send rematch_accepted to BOTH players
            if (room.hostId) {
                sendToPlayer(room.hostId, 'rematch_accepted');
            }
            if (room.guestId) {
                sendToPlayer(room.guestId, 'rematch_accepted');
            }
            break;
        }

        case 'leave': {
            const opponentId = handlePlayerLeave(playerId);
            if (opponentId) {
                sendToPlayer(opponentId, 'opponent_left');
            }
            break;
        }

        default: {
            sendTo(player.ws, 'error', { message: `Unknown type: ${msg.type}` });
        }
    }
}

// ===== Start =====
server.listen(PORT, () => {
    console.log(`Tic-Tac-Toe server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to play`);
});
