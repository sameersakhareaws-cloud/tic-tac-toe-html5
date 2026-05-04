/**
 * Multiplayer module
 * 
 * Strategy:
 *   1. Try WebSocket server first (for cross-network multiplayer)
 *   2. Fall back to BroadcastChannel (same-browser, cross-tab for dev/testing)
 *
 * The BroadcastChannel fallback implements a lightweight room protocol:
 *   - First tab to claim a room code becomes the "host"
 *   - Second tab sends a join request; host accepts and becomes the relay
 *   - Moves are relayed through the host tab (which acts as mini-server)
 */
const Multiplayer = (() => {
    let ws = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    let useWS = true; // true = WebSocket mode, false = BroadcastChannel mode
    let channel = null;
    const listeners = {};

    // WebSocket server URL — change this to your deployed server
    const WS_URL = 'wss://tic-tac-toe-ws.onrender.com';

    // ===== Event System =====

    function on(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
    }

    function off(event, callback) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }

    function emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error('MP listener error:', e); }
            });
        }
    }

    // ===== Connection =====

    function connect() {
        return new Promise((resolve) => {
            emit('connectionChange', { state: 'connecting' });

            // Try WebSocket first
            try {
                ws = new WebSocket(WS_URL);
            } catch (e) {
                console.log('MP: WebSocket constructor failed, using local mode');
                startLocalMode().then(resolve);
                return;
            }

            const timeout = setTimeout(() => {
                if (!connected) {
                    console.log('MP: WebSocket timeout, using local mode');
                    try { ws.close(); } catch(e) {}
                    ws = null;
                    startLocalMode().then(resolve);
                }
            }, 4000);

            ws.onopen = () => {
                clearTimeout(timeout);
                connected = true;
                useWS = true;
                emit('connectionChange', { state: 'connected' });
                resolve(true);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleMessage(msg);
                } catch (e) {
                    console.error('MP: Failed to parse WS message:', e);
                }
            };

            ws.onclose = () => {
                if (connected) {
                    connected = false;
                    emit('connectionChange', { state: 'disconnected' });
                }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                // onclose will fire next
            };
        });
    }

    // ===== BroadcastChannel (Local) Mode =====

    function startLocalMode() {
        return new Promise((resolve) => {
            useWS = false;
            connected = true;

            try {
                channel = new BroadcastChannel('tictactoe-v1');
                channel.onmessage = (event) => {
                    handleLocalMessage(event.data);
                };
            } catch (e) {
                console.log('MP: BroadcastChannel not supported');
            }

            emit('connectionChange', { state: 'connected' });
            resolve(true);
        });
    }

    /**
     * In local mode, messages need a `target` field:
     *   - 'broadcast' → everyone processes it
     *   - room code → only tabs with that roomId process it
     *
     * Protocol:
     *   create_room: Tab generates room code, announces "room exists"
     *   join_request: Guest sends join request to room
     *   join_accepted: Host accepts guest, assigns symbol O
     *   move: Relayed through host or direct
     *   rematch_request / rematch_accepted
     *   opponent_left
     */
    function handleLocalMessage(msg) {
        // Only process messages for our room or broadcasts
        if (msg.target && msg.target !== 'broadcast' && msg.target !== myRoom) {
            return;
        }

        switch (msg.type) {
            case 'create_room': {
                // Another tab created a room — store it so join can find it
                // We track rooms in a shared way via broadcast
                break;
            }

            case 'join_request': {
                // Only the host should respond
                if (mySymbol === 'X' && myRoom === msg.roomId) {
                    // Accept the guest
                    const guestName = msg.name || 'Guest';
                    channel.postMessage({
                        type: 'join_accepted',
                        target: msg.roomId,
                        roomId: myRoom,
                        symbol: 'O',
                        hostName: myName
                    });
                    // Notify local listeners
                    emit('opponentJoined', { name: guestName, symbol: 'O' });
                }
                break;
            }

            case 'join_accepted': {
                if (msg.roomId === myRoom && mySymbol === 'O') {
                    mySymbol = msg.symbol;
                    emit('roomJoined', {
                        roomId: msg.roomId,
                        symbol: msg.symbol,
                        hostName: msg.hostName
                    });
                }
                break;
            }

            case 'move': {
                if (msg.roomId === myRoom) {
                    emit('move', { cell: msg.cell, player: msg.player });
                }
                break;
            }

            case 'rematch_request': {
                if (msg.roomId === myRoom) {
                    emit('rematchRequested', {});
                }
                break;
            }

            case 'rematch_accepted': {
                if (msg.roomId === myRoom) {
                    emit('rematchAccepted', {});
                }
                break;
            }

            case 'opponent_left': {
                if (msg.roomId === myRoom) {
                    emit('opponentLeft', {});
                }
                break;
            }
        }
    }

    function send(data) {
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else if (!useWS && channel) {
            channel.postMessage(data);
        }
    }

    // ===== Message Handling (WebSocket mode) =====

    function handleMessage(msg) {
        switch (msg.type) {
            case 'room_created':
                myRoom = msg.roomId;
                mySymbol = 'X';
                emit('roomCreated', { roomId: msg.roomId, symbol: 'X' });
                break;

            case 'room_joined':
                myRoom = msg.roomId;
                mySymbol = msg.symbol;
                emit('roomJoined', { roomId: msg.roomId, symbol: msg.symbol, hostName: msg.hostName });
                break;

            case 'join_failed':
                emit('joinFailed', { reason: msg.reason });
                break;

            case 'opponent_joined':
                emit('opponentJoined', { name: msg.name, symbol: 'O' });
                break;

            case 'opponent_left':
                emit('opponentLeft', {});
                break;

            case 'move':
                emit('move', { cell: msg.cell, player: msg.player });
                break;

            case 'rematch_requested':
                emit('rematchRequested', {});
                break;

            case 'rematch_accepted':
                emit('rematchAccepted', {});
                break;

            case 'error':
                emit('error', { message: msg.message });
                break;

            default:
                emit(msg.type, msg);
        }
    }

    // ===== Public API =====

    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    function createRoom(playerName) {
        myName = playerName || 'Player';
        myRoom = generateRoomCode();
        mySymbol = 'X';

        if (useWS) {
            send({ type: 'create_room', name: myName });
        } else {
            // Local mode: announce room creation, then emit locally
            if (channel) {
                channel.postMessage({
                    type: 'create_room',
                    target: 'broadcast',
                    roomId: myRoom,
                    name: myName
                });
            }
            // Emit locally since there's no server to echo back
            emit('roomCreated', { roomId: myRoom, symbol: 'X' });
        }
    }

    function joinRoom(roomCode, playerName) {
        myName = playerName || 'Player';
        myRoom = roomCode.toUpperCase();
        mySymbol = 'O'; // Will be confirmed by host

        if (useWS) {
            send({ type: 'join_room', roomId: myRoom, name: myName });
        } else {
            // Local mode: send join request to room
            if (channel) {
                channel.postMessage({
                    type: 'join_request',
                    target: myRoom,
                    roomId: myRoom,
                    name: myName
                });
            }
        }
    }

    function sendMove(cellIndex, player) {
        if (useWS) {
            send({ type: 'move', cell: cellIndex, roomId: myRoom, player: player || mySymbol });
        } else {
            if (channel) {
                channel.postMessage({
                    type: 'move',
                    target: myRoom,
                    roomId: myRoom,
                    cell: cellIndex,
                    player: player || mySymbol
                });
            }
        }
    }

    function requestRematch() {
        if (useWS) {
            send({ type: 'rematch_request', roomId: myRoom });
        } else {
            if (channel) {
                channel.postMessage({
                    type: 'rematch_request',
                    target: myRoom,
                    roomId: myRoom
                });
            }
        }
    }

    function acceptRematch() {
        if (useWS) {
            send({ type: 'rematch_accept', roomId: myRoom });
        } else {
            if (channel) {
                channel.postMessage({
                    type: 'rematch_accepted',
                    target: myRoom,
                    roomId: myRoom
                });
            }
        }
    }

    function leaveRoom() {
        if (myRoom) {
            if (useWS) {
                send({ type: 'leave', roomId: myRoom });
            } else {
                if (channel) {
                    channel.postMessage({
                        type: 'opponent_left',
                        target: myRoom,
                        roomId: myRoom
                    });
                }
            }
            myRoom = null;
            mySymbol = null;
        }
    }

    function isConnected() { return connected; }
    function getRoom() { return myRoom; }
    function getSymbol() { return mySymbol; }

    return {
        connect,
        on,
        off,
        createRoom,
        joinRoom,
        sendMove,
        requestRematch,
        acceptRematch,
        leaveRoom,
        isConnected,
        getRoom,
        getSymbol
    };
})();
