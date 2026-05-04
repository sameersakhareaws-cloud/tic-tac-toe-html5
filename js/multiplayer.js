/**
 * Multiplayer module — handles room creation, joining, and move relay.
 *
 * Two modes:
 *   1. WebSocket (production) — connects to a WS server for cross-network play
 *   2. Local (dev/fallback) — uses BroadcastChannel for same-browser cross-tab play
 *
 * connect() ALWAYS resolves within ~3.5s — falls back to local mode if WS fails.
 */
const Multiplayer = (() => {
    let ws = null;
    let channel = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    let useWS = false;
    const listeners = {};

    const WS_URL = 'wss://tic-tac-toe-ws.onrender.com';
    const WS_TIMEOUT = 3000;

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

    function connect() {
        return new Promise((resolve) => {
            emit('connectionChange', { state: 'connecting' });

            let resolved = false;
            let localStarted = false;

            function done(mode) {
                if (resolved) return;
                resolved = true;
                connected = true;
                console.log('MP: Connected via', mode);
                emit('connectionChange', { state: 'connected' });
                resolve(true);
            }

            function startLocalMode(reason) {
                if (localStarted) return;
                localStarted = true;
                console.log('MP: Starting local mode:', reason);

                useWS = false;
                try {
                    channel = new BroadcastChannel('tictactoe-v1');
                    channel.onmessage = (event) => {
                        handleLocalMessage(event.data);
                    };
                } catch (e) {
                    console.log('MP: BroadcastChannel not supported');
                }
                done('local');
            }

            // Try WebSocket
            try {
                ws = new WebSocket(WS_URL);
            } catch (e) {
                startLocalMode('WebSocket constructor failed: ' + e.message);
                return;
            }

            const timeout = setTimeout(() => {
                if (!resolved) {
                    console.log('MP: WebSocket timeout after ' + WS_TIMEOUT + 'ms');
                    try { ws.close(); } catch (e) {}
                    ws = null;
                    startLocalMode('timeout');
                }
            }, WS_TIMEOUT);

            ws.onopen = () => {
                clearTimeout(timeout);
                if (resolved) { try { ws.close(); } catch (e) {} return; }
                useWS = true;
                ws = ws; // keep reference
                done('websocket');
            };

            ws.onmessage = (event) => {
                try {
                    handleWSMessage(JSON.parse(event.data));
                } catch (e) { console.error('MP: parse error:', e); }
            };

            ws.onclose = () => {
                if (useWS && connected) {
                    connected = false;
                    emit('connectionChange', { state: 'disconnected' });
                }
            };

            ws.onerror = () => {
                // Clear timeout — onclose will fire next and we'll fallback
                clearTimeout(timeout);
                // Wait a tick for onclose, then fallback if not resolved
                setTimeout(() => {
                    if (!resolved) {
                        try { ws.close(); } catch (e) {}
                        ws = null;
                        startLocalMode('websocket error');
                    }
                }, 100);
            };
        });
    }

    // ===== Local (BroadcastChannel) Mode =====

    function handleLocalMessage(msg) {
        if (!msg || !msg.type) return;

        // Filter by room (except global broadcasts)
        const isForMyRoom = msg.roomId && msg.roomId === myRoom;
        const isGlobal = !msg.roomId;

        if (!isGlobal && !isForMyRoom) return;

        console.log('MP local msg:', msg.type, msg.roomId || '(global)');

        switch (msg.type) {
            case 'room_exists':
                console.log('MP: Room exists:', msg.roomId, 'host:', msg.hostName);
                break;

            case 'join_request':
                if (mySymbol === 'X' && myRoom === msg.roomId) {
                    console.log('MP: Guest joining:', msg.guestName);
                    if (channel) {
                        channel.postMessage({
                            type: 'join_accept',
                            roomId: myRoom,
                            guestName: msg.guestName,
                            hostName: myName
                        });
                    }
                    emit('opponentJoined', { name: msg.guestName || 'Guest' });
                }
                break;

            case 'join_accept':
                if (mySymbol === 'O' && myRoom === msg.roomId) {
                    console.log('MP: Join accepted by host:', msg.hostName);
                    emit('roomJoined', {
                        roomId: myRoom,
                        symbol: 'O',
                        hostName: msg.hostName
                    });
                }
                break;

            case 'move':
                if (isForMyRoom && msg.player !== mySymbol) {
                    emit('move', { cell: msg.cell, player: msg.player });
                }
                break;

            case 'rematch_req':
                if (isForMyRoom) emit('rematchRequested', {});
                break;

            case 'rematch_ack':
                if (isForMyRoom) emit('rematchAccepted', {});
                break;

            case 'peer_left':
                if (isForMyRoom) emit('opponentLeft', {});
                break;
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

    // ===== Send =====

    function send(data) {
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else if (!useWS && channel) {
            channel.postMessage(data);
        }
    }

    // ===== Public API =====

    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    function createRoom(playerName) {
        myName = playerName || 'Player';
        myRoom = generateRoomCode();
        mySymbol = 'X';
        console.log('MP: Creating room', myRoom, 'mode:', useWS ? 'ws' : 'local');

        if (useWS) {
            send({ type: 'create_room', name: myName });
        } else {
            if (channel) {
                channel.postMessage({ type: 'room_exists', roomId: myRoom, hostName: myName });
            }
            emit('roomCreated', { roomId: myRoom, symbol: 'X' });
        }
    }

    function joinRoom(roomCode, playerName) {
        myName = playerName || 'Player';
        myRoom = roomCode.toUpperCase();
        mySymbol = 'O';
        console.log('MP: Joining room', myRoom, 'mode:', useWS ? 'ws' : 'local');

        if (useWS) {
            send({ type: 'join_room', roomId: myRoom, name: myName });
        } else {
            if (channel) {
                channel.postMessage({ type: 'join_request', roomId: myRoom, guestName: myName });
            }
        }
    }

    function sendMove(cellIndex, player) {
        const p = player || mySymbol;
        if (useWS) {
            send({ type: 'move', cell: cellIndex, roomId: myRoom, player: p });
        } else {
            if (channel) {
                channel.postMessage({ type: 'move', roomId: myRoom, cell: cellIndex, player: p });
            }
        }
    }

    function requestRematch() {
        if (useWS) {
            send({ type: 'rematch_request', roomId: myRoom });
        } else {
            if (channel) channel.postMessage({ type: 'rematch_req', roomId: myRoom });
        }
    }

    function acceptRematch() {
        if (useWS) {
            send({ type: 'rematch_accept', roomId: myRoom });
        } else {
            if (channel) channel.postMessage({ type: 'rematch_ack', roomId: myRoom });
        }
    }

    function leaveRoom() {
        if (myRoom) {
            if (useWS) {
                send({ type: 'leave', roomId: myRoom });
            } else {
                if (channel) channel.postMessage({ type: 'peer_left', roomId: myRoom });
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
        connect, on, off,
        createRoom, joinRoom, sendMove,
        requestRematch, acceptRematch, leaveRoom,
        isConnected, getRoom, getSymbol
    };
})();
