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
        hostId,
        hostName: hostName || 'Host',
        hostBalance: 0, // will be set via balance_update from host client
        guestId: null,
        guestName: null,
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
    if (!room || !room.hostId) return { success: false, reason: 'Room not found' };
    if (room.guestId) return { success: false, reason: 'Room is full' };
    if (room.hostId === guestId) return { success: false, reason: 'Cannot join your own room' };

    room.guestName = guestName || 'Guest';
    room.guestId = guestId;
    return { success: true, room };
}

/**
 * Handle a player leaving. Returns the opponent's playerId (if any) for notification.
 * The room is destroyed immediately — both players must leave.
 */
function handlePlayerLeave(playerId) {
    const player = players.get(playerId);
    if (!player || !player.roomId) return null;

    const roomId = player.roomId;
    const room = rooms.get(roomId);
    if (!room) return null;

    // Find the opponent before we destroy anything
    const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;

    // Destroy the room entirely
    rooms.delete(roomId);
    console.log(`Room ${roomId} destroyed — player ${playerId} left`);

    // Clear room reference for the leaving player
    player.roomId = null;

    return opponentId;
}

/**
 * Check if a room is available for joining.
 */
function isRoomJoinable(room) {
    return !!room.hostId && !room.guestId;
}

// Clean up expired rooms every minute
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
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
                    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
                    res.end(data2);
                }
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
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
            // Room creation – wait for host to send balance later via 'balance_update'

            // Initialize host balance placeholder
            // Will be updated via 'balance_update' from client

            const playerName = msg.name || 'Host';
            const roomId = createRoom(playerId, playerName);
            player.roomId = roomId;
            player.name = playerName;
            sendTo(player.ws, 'room_created', { roomId });
            console.log(`Room ${roomId} created by ${playerId}`);
            break;
        }

        case 'join_room': {
            // join handling remains same – after join, the client will send its balance separately

            // If the joining player sends a balance update as part of join, store it
            if (msg.balance !== undefined && playerId) {
                // Wait until room is created to set host balance below
                // We'll set hostBalance after creating room
            }
            const roomId = msg.roomId.toUpperCase();
            const result = joinRoom(roomId, playerId, msg.name);

            if (result.success) {
                player.roomId = roomId;
                player.name = msg.name || 'Guest';

                // Include the host's current balance for the guest to display
            const hostBal = result.room.hostBalance || 0;
            sendTo(player.ws, 'room_joined', {
                roomId,
                symbol: 'O',
                hostName: result.room.hostName,
                hostBalance: hostBal
            });

                // Notify host
                if (result.room.hostId) {
                    sendToPlayer(result.room.hostId, 'opponent_joined', {
                        balance: result.room.guestBalance || 0,
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

        case 'balance_update': {
            // Update the stored balance for this player in the room
            const roomId = player.roomId;
            if (roomId) {
                const room = rooms.get(roomId);
                if (room) {
                    if (playerId === room.hostId) {
                        room.hostBalance = msg.balance || 0;
                        // If guest already present, inform them of host balance
                        if (room.guestId) {
                            sendToPlayer(room.guestId, 'opponent_joined', {
                                name: room.hostName,
                                balance: room.hostBalance,
                                symbol: 'X'
                            });
                        }
                    } else {
                        // Guest balance
                        room.guestBalance = msg.balance || 0;
                        // Inform host of guest balance
                        if (room.hostId) {
                            sendToPlayer(room.hostId, 'opponent_joined', {
                                name: room.guestName,
                                balance: room.guestBalance,
                                symbol: 'O'
                            });
                        }
                    }
                }
            }
            // No further response needed (UI will update on opponentJoined)
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
