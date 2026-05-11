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
        createdAt: Date.now(),
        // Blind bid state
        hostBid: undefined,
        guestBid: undefined,
        wager: 0,
        wagerLocked: false
    });
    return roomId;
}

function joinRoom(roomId, guestId, guestName) {
    const room = rooms.get(roomId);
    if (!room) return { success: false, reason: 'Room not found' };
    if (!isRoomJoinable(room)) return { success: false, reason: 'Room not found' };
    if (room.guestId) return { success: false, reason: 'Room is full' };
    if (room.hostId === guestId) return { success: false, reason: 'Cannot join your own room' };

    room.guestName = guestName || 'Guest';
    room.guestId = guestId;
    // If host was in grace period, clear the disconnect marker
    if (!room.hostId && room.hostDisconnectedAt) {
        room.hostDisconnectedAt = null;
    }
    return { success: true, room };
}

const HOST_RECONNECT_GRACE_MS = 30000; // 30s grace period for host reconnection

/**
 * Handle a player leaving. Returns the opponent's playerId (if any) for notification.
 * If host leaves, the room enters a grace period — host can reconnect within 30s.
 * If guest leaves, the room stays with the host.
 */
function handlePlayerLeave(playerId) {
    const player = players.get(playerId);
    if (!player || !player.roomId) return null;

    const roomId = player.roomId;
    const room = rooms.get(roomId);
    if (!room) return null;

    let opponentId = null;

    if (room.hostId === playerId) {
        // Host leaves — enter grace period, notify guest
        opponentId = room.guestId;
        room.hostDisconnectedAt = Date.now();
        room.hostId = null;
    } else if (room.guestId === playerId) {
        // Guest leaves — keep room, notify host
        opponentId = room.hostId;
        room.guestName = null;
        room.guestId = null;
    }

    player.roomId = null;
    return opponentId;
}

/**
 * Check if a room is available for joining.
 * Rooms in grace period (host disconnected) are still joinable.
 */
function isRoomJoinable(room) {
    if (!room.hostId && room.hostDisconnectedAt) {
        // Host disconnected but within grace period
        return (Date.now() - room.hostDisconnectedAt) < HOST_RECONNECT_GRACE_MS;
    }
    return !!room.hostId;
}

// Clean up expired rooms every minute
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
        // Remove rooms past grace period (host never reconnected)
        if (!room.hostId && room.hostDisconnectedAt &&
            now - room.hostDisconnectedAt > HOST_RECONNECT_GRACE_MS) {
            rooms.delete(id);
            continue;
        }
        // Remove rooms older than 1 hour
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
            // Check if there's a room in grace period (host disconnected) that this player can reclaim
            // We match by hostName since the old playerId is gone after disconnect
            const playerName = msg.name || 'Host';
            let reclaimedRoom = null;
            for (const [id, room] of rooms) {
                if (!room.hostId && room.hostDisconnectedAt &&
                    room.hostName === playerName) {
                    reclaimedRoom = room;
                    reclaimedRoom.hostId = playerId;
                    reclaimedRoom.hostDisconnectedAt = null;
                    player.roomId = id;
                    player.name = playerName;
                    sendTo(player.ws, 'room_created', { roomId: id });
                    console.log(`Room ${id} reclaimed by ${playerId}`);
                    // Notify guest if present
                    if (reclaimedRoom.guestId) {
                        sendToPlayer(reclaimedRoom.guestId, 'opponent_joined', {
                            name: playerName,
                            symbol: 'X'
                        });
                    }
                    break;
                }
            }
            if (!reclaimedRoom) {
                const roomId = createRoom(playerId, playerName);
                player.roomId = roomId;
                player.name = playerName;
                sendTo(player.ws, 'room_created', { roomId });
                console.log(`Room ${roomId} created by ${playerId}`);
            }
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

                // Notify host (if connected — skip if host is in grace period)
                if (result.room.hostId) {
                    sendToPlayer(result.room.hostId, 'opponent_joined', {
                        name: player.name,
                        symbol: 'O'
                    });
                }

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
            // Reset bid state for the new round
            room.hostBid = undefined;
            room.guestBid = undefined;
            room.wager = 0;
            room.wagerLocked = false;
            // Send rematch_accepted to BOTH players
            if (room.hostId) {
                sendToPlayer(room.hostId, 'rematch_accepted');
            }
            if (room.guestId) {
                sendToPlayer(room.guestId, 'rematch_accepted');
            }
            console.log(`Rematch accepted in room ${msg.roomId} — bid state reset`);
            break;
        }

        // ===== Blind Bid Wager Handlers =====

        case 'place_bid': {
            const room = rooms.get(msg.roomId);
            if (!room) {
                sendTo(player.ws, 'error', { message: 'Room not found' });
                return;
            }
            // Store the bid on the room
            if (room.hostId === playerId) {
                room.hostBid = msg.amount;
            } else if (room.guestId === playerId) {
                room.guestBid = msg.amount;
            }
            // Notify opponent that a bid was locked (but not the amount)
            const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
            if (opponentId) {
                sendToPlayer(opponentId, 'bid_locked');
            }
            // If both bids are in, reveal
            if (room.hostBid !== undefined && room.guestBid !== undefined) {
                const finalWager = Math.min(room.hostBid, room.guestBid);
                const pot = finalWager * 2;
                const bonus = room.hostBid === room.guestBid;
                room.wager = finalWager;
                room.wagerLocked = true;
                // Send reveal to host
                if (room.hostId) {
                    sendToPlayer(room.hostId, 'bid_reveal', {
                        yourBid: room.hostBid,
                        opponentBid: room.guestBid,
                        finalWager,
                        pot,
                        bonus
                    });
                }
                // Send reveal to guest
                if (room.guestId) {
                    sendToPlayer(room.guestId, 'bid_reveal', {
                        yourBid: room.guestBid,
                        opponentBid: room.hostBid,
                        finalWager,
                        pot,
                        bonus
                    });
                }
                console.log(`Bid reveal: host=${room.hostBid} guest=${room.guestBid} final=${finalWager} bonus=${bonus}`);
            }
            break;
        }

        case 'veto_bid': {
            const room = rooms.get(msg.roomId);
            if (!room) return;
            // Notify both players of veto
            if (room.hostId) sendToPlayer(room.hostId, 'bid_veto', { vetoedBy: playerId });
            if (room.guestId) sendToPlayer(room.guestId, 'bid_veto', { vetoedBy: playerId });
            break;
        }

        case 'bid_start': {
            const room = rooms.get(msg.roomId);
            if (!room || !room.wagerLocked) return;
            // Notify both players to start the game
            const startData = { wager: room.wager, pot: room.wager * 2 };
            if (room.hostId) sendToPlayer(room.hostId, 'bid_start', startData);
            if (room.guestId) sendToPlayer(room.guestId, 'bid_start', startData);
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
