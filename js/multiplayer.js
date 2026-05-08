/**
 * Multiplayer module — handles room creation, joining, and move relay.
 *
 * Two modes:
 *   1. WebSocket (production) — cross-network play via WS server
 *   2. Local (dev/fallback) — same-origin cross-tab via localStorage events
 *
 * connect() ALWAYS resolves — falls back to local mode if WS fails.
 *
 * SHOULD-DO FIXES:
 * 8. Rematch keeps room alive, updates room data for invite continuity
 */
const Multiplayer = (() => {
    let ws = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    let useWS = false;
    const listeners = {};

    const WS_URL = 'ws://' + window.location.hostname + ':3002';
    const WS_TIMEOUT = 3000;
    const STORAGE_PREFIX = 'ttmp_';

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
                window.addEventListener('storage', handleStorageEvent);
                localStorage.setItem(STORAGE_PREFIX + 'mode', 'local');
                done('local');
            }

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
                done('websocket');
            };

            ws.onmessage = (event) => {
                try { handleWSMessage(JSON.parse(event.data)); }
                catch (e) { console.error('MP: parse error:', e); }
            };

            ws.onclose = () => {
                if (useWS && connected) {
                    connected = false;
                    emit('connectionChange', { state: 'disconnected' });
                }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
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

    // ===== Local Mode =====

    function handleStorageEvent(event) {
        if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) return;
        if (!event.newValue) return;
        try { handleLocalMessage(JSON.parse(event.newValue)); } catch (e) {}
    }

    function localSend(msg) {
        if (!myRoom) return;
        msg.sender = myName;
        msg._ts = Date.now();
        const key = STORAGE_PREFIX + myRoom + '_' + msg._ts;
        localStorage.setItem(key, JSON.stringify(msg));
        setTimeout(() => localStorage.removeItem(key), 5000);
    }

    function handleLocalMessage(msg) {
        if (!msg || !msg.type) return;
        const isForMyRoom = msg.roomId && msg.roomId === myRoom;
        const isGlobal = !msg.roomId;
        if (!isGlobal && !isForMyRoom) return;

        switch (msg.type) {
            case 'room_exists':
                registerRoom(msg.roomId, msg.hostName);
                break;
            case 'join_request':
                if (mySymbol === 'X' && myRoom === msg.roomId) {
                    localSend({ type: 'join_accept', roomId: myRoom, guestName: msg.guestName, hostName: myName });
                    emit('opponentJoined', { name: msg.guestName || 'Guest' });
                }
                break;
            case 'join_accept':
                if (mySymbol === 'O' && myRoom === msg.roomId) {
                    emit('roomJoined', { roomId: myRoom, symbol: 'O', hostName: msg.hostName });
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

    function registerRoom(roomId, hostName) {
        let rooms = {};
        try { rooms = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'rooms') || '{}'); } catch (e) {}
        rooms[roomId] = { hostName, createdAt: Date.now() };
        localStorage.setItem(STORAGE_PREFIX + 'rooms', JSON.stringify(rooms));
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

    function send(data) {
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else if (!useWS) {
            localSend(data);
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
            registerRoom(myRoom, myName);
            localSend({ type: 'room_exists', roomId: myRoom, hostName: myName });
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
            localSend({ type: 'join_request', roomId: myRoom, guestName: myName });
        }
    }

    function sendMove(cellIndex, player) {
        const p = player || mySymbol;
        if (useWS) {
            send({ type: 'move', cell: cellIndex, roomId: myRoom, player: p });
        } else {
            localSend({ type: 'move', roomId: myRoom, cell: cellIndex, player: p });
        }
    }

    // Fix 8: Rematch keeps room alive — don't clear myRoom/mySymbol
    function requestRematch() {
        if (useWS) {
            send({ type: 'rematch_request', roomId: myRoom });
        } else {
            localSend({ type: 'rematch_req', roomId: myRoom });
        }
    }

    function acceptRematch() {
        if (useWS) {
            send({ type: 'rematch_accept', roomId: myRoom });
        } else {
            localSend({ type: 'rematch_ack', roomId: myRoom });
            emit('rematchAccepted', {});
        }
    }

    // Fix 8: leaveRoom only clears state when explicitly leaving (not on rematch)
    function leaveRoom() {
        if (myRoom) {
            if (useWS) {
                send({ type: 'leave', roomId: myRoom });
            } else {
                localSend({ type: 'peer_left', roomId: myRoom });
            }
            console.log('MP: Left room', myRoom);
            myRoom = null;
            mySymbol = null;
        }
    }

    function isConnected() { return connected; }
    function getRoom() { return myRoom; }
    function getSymbol() { return mySymbol; }
    function getName() { return myName; }

    return {
        connect, on, off,
        createRoom, joinRoom, sendMove,
        requestRematch, acceptRematch, leaveRoom,
        isConnected, getRoom, getSymbol, getName
    };
})();
