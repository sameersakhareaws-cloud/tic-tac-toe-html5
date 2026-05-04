/**
 * Multiplayer module — handles room creation, joining, and move relay.
 *
 * Two modes:
 *   1. WebSocket (production) — connects to a WS server for cross-network play
 *   2. Local (dev/fallback) — uses BroadcastChannel for same-browser cross-tab play
 *
 * The connect() promise always resolves — it falls back to local mode if WS fails.
 */
const Multiplayer = (() {
    // State
    let ws = null;
    let channel = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    let useWS = false;

    const listeners = {};

    // Config
    const WS_URL = 'wss://tic-tac-toe-ws.onrender.com';
    const WS_TIMEOUT = 3000; // ms before falling back to local

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
                try { cb(data); } catch (e) { console.error('MP emit error:', e); }
            });
        }
    }

    // ===== Connection =====

    /**
     * Connect to multiplayer. Always resolves — falls back to local mode.
     */
    function connect() {
        return new Promise((resolve) => {
            emit('connectionChange', { state: 'connecting' });

            // Try WebSocket first
            let wsAttempted = false;
            let localStarted = false;

            function fallbackToLocal(reason) {
                if (localStarted) return;
                localStarted = true;
                console.log('MP: Falling back to local mode:', reason);
                startLocal().then(resolve);
            }

            try {
                ws = new WebSocket(WS_URL);
            } catch (e) {
                fallbackToLocal('WebSocket constructor failed: ' + e.message);
                return;
            }

            const timeout = setTimeout(() => {
                if (!connected && !localStarted) {
                    try { ws.close(); } catch (e) {}
                    ws = null;
                    fallbackToLocal('WebSocket timeout');
                }
            }, WS_TIMEOUT);

            ws.onopen = () => {
                clearTimeout(timeout);
                if (localStarted) {
                    // Local mode already started, ignore this
                    try { ws.close(); } catch (e) {}
                    return;
                }
                connected = true;
                useWS = true;
                wsAttempted = true;
                emit('connectionChange', { state: 'connected' });
                console.log('MP: Connected via WebSocket');
                resolve(true);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleWSMessage(msg);
                } catch (e) {
                    console.error('MP: Failed to parse message:', e);
                }
            };

            ws.onclose = () => {
                if (useWS && connected) {
                    connected = false;
                    emit('connectionChange', { state: 'disconnected' });
                }
            };

            ws.onerror = (err) => {
                clearTimeout(timeout);
                // Don't do anything here — let timeout or onclose handle it
                console.log('MP: WebSocket error, will fallback');
            };
        });
    }

    // ===== Local (BroadcastChannel) Mode =====

    function startLocal() {
        return new Promise((resolve) => {
            useWS = false;
            connected = true;

            try {
                channel = new BroadcastChannel('tictactoe-v1');
                channel.onmessage = (event) => {
                    handleLocalMessage(event.data);
                };
                console.log('MP: Local mode active via BroadcastChannel');
            } catch (e) {
                console.log('MP: BroadcastChannel not supported, local mode limited');
            }

            emit('connectionChange', { state: 'connected' });
            resolve(true);
        });
    }

    /**
     * Local message protocol:
     *
     * When a host creates a room:
     *   → channel: { type: 'room_exists', roomId, hostName }
     *
     * When a guest wants to join:
     *   → channel: { type: 'join_request', roomId, guestName }
     *   ← channel: { type: 'join_accept', roomId, guestName, hostName }  (host → guest)
     *
     * When a move is made:
     *   → channel: { type: 'move', roomId, cell, player }
     *
     * Rematch:
     *   → channel: { type: 'rematch_req', roomId }
     *   → channel: { type: 'rematch_ack', roomId }
     *
     * Leave:
     *   → channel: { type: 'peer_left', roomId }
     */
    function handleLocalMessage(msg) {
        // Filter: only process messages for our room (or global broadcasts)
        const isGlobal = !msg.roomId;
        const isForMyRoom = msg.roomId && msg.roomId === myRoom;

        if (!isGlobal && !isForMyRoom) return;

        switch (msg.type) {
            case 'room_exists': {
                // Another tab announced a room — we might want to know about it
                // For now, we just log it. The user needs to know the code from the host tab.
                console.log('MP: Room exists:', msg.roomId, 'host:', msg.hostName);
                break;
            }

            case 'join_request': {
                // Only the host of this room should respond
                if (mySymbol === 'X' && myRoom === msg.roomId) {
                    console.log('MP: Guest joining:', msg.guestName);
                    // Send accept back
                    if (channel) {
                        channel.postMessage({
                            type: 'join_accept',
                            roomId: myRoom,
                            guestName: msg.guestName,
                            hostName: myName
                        });
                    }
                    // Notify local game
                    emit('opponentJoined', { name: msg.guestName || 'Guest' });
                }
                break;
            }

            case 'join_accept': {
                // Only the guest who is waiting should process this
                if (mySymbol === 'O' && myRoom === msg.roomId) {
                    console.log('MP: Join accepted by host:', msg.hostName);
                    emit('roomJoined', {
                        roomId: myRoom,
                        symbol: 'O',
                        hostName: msg.hostName
                    });
                }
                break;
            }

            case 'move': {
                if (isForMyRoom && msg.player !== mySymbol) {
                    emit('move', { cell: msg.cell, player: msg.player });
                }
                break;
            }

            case 'rematch_req': {
                if (isForMyRoom) {
                    emit('rematchRequested', {});
                }
                break;
            }

            case 'rematch_ack': {
                if (isForMyRoom) {
                    emit('rematchAccepted', {});
                }
                break;
            }

            case 'peer_left': {
                if (isForMyRoom) {
                    emit('opponentLeft', {});
                }
                break;
            }
        }
    }

    // ===== Send =====

    function send(data) {
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else if (!useWS && channel) {
            channel.postMessage(data);
        }
    }

    // ===== WebSocket Message Handling =====

    function handleWSMessage(msg) {
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
                emit('opponentJoined', { name: msg.name });
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

        console.log('MP: Creating room', myRoom);

        if (useWS) {
            send({ type: 'create_room', name: myName });
        } else {
            // Local: announce room exists, then emit locally
            if (channel) {
                channel.postMessage({
                    type: 'room_exists',
                    roomId: myRoom,
                    hostName: myName
                });
            }
            // Emit locally since there's no server to echo back
            emit('roomCreated', { roomId: myRoom, symbol: 'X' });
        }
    }

    function joinRoom(roomCode, playerName) {
        myName = playerName || 'Player';
        myRoom = roomCode.toUpperCase();
        mySymbol = 'O';

        console.log('MP: Joining room', myRoom);

        if (useWS) {
            send({ type: 'join_room', roomId: myRoom, name: myName });
        } else {
            // Local: send join request
            if (channel) {
                channel.postMessage({
                    type: 'join_request',
                    roomId: myRoom,
                    guestName: myName
                });
            }
        }
    }

    function sendMove(cellIndex, player) {
        const p = player || mySymbol;
        if (useWS) {
            send({ type: 'move', cell: cellIndex, roomId: myRoom, player: p });
        } else {
            if (channel) {
                channel.postMessage({
                    type: 'move',
                    roomId: myRoom,
                    cell: cellIndex,
                    player: p
                });
            }
        }
    }

    function requestRematch() {
        if (useWS) {
            send({ type: 'rematch_request', roomId: myRoom });
        } else {
            if (channel) {
                channel.postMessage({ type: 'rematch_req', roomId: myRoom });
            }
        }
    }

    function acceptRematch() {
        if (useWS) {
            send({ type: 'rematch_accept', roomId: myRoom });
        } else {
            if (channel) {
                channel.postMessage({ type: 'rematch_ack', roomId: myRoom });
            }
        }
    }

    function leaveRoom() {
        if (myRoom) {
            if (useWS) {
                send({ type: 'leave', roomId: myRoom });
            } else {
                if (channel) {
                    channel.postMessage({ type: 'peer_left', roomId: myRoom });
                }
            }
            console.log('MP: Left room', myRoom);
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
