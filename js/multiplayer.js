/**
 * Multiplayer module — WebSocket-based room management
 */
const Multiplayer = (() => {
    let ws = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    const listeners = {};

    // WebSocket server URL — change this to your deployed server
    const WS_URL = 'wss://tic-tac-toe-ws.onrender.com';

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
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    function connect() {
        return new Promise((resolve, reject) => {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                resolve(true);
                return;
            }

            emit('connectionChange', { state: 'connecting' });

            try {
                ws = new WebSocket(WS_URL);
            } catch (e) {
                // Fallback: simulate local multiplayer for dev
                console.log('WebSocket connection failed, using local mode');
                simulateConnection().then(resolve).catch(reject);
                return;
            }

            const timeout = setTimeout(() => {
                if (!connected) {
                    console.log('WebSocket timeout, using local mode');
                    try { ws.close(); } catch(e) {}
                    simulateConnection().then(resolve).catch(reject);
                }
            }, 5000);

            ws.onopen = () => {
                clearTimeout(timeout);
                connected = true;
                emit('connectionChange', { state: 'connected' });
                resolve(true);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleMessage(msg);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };

            ws.onclose = () => {
                connected = false;
                emit('connectionChange', { state: 'disconnected' });
            };

            ws.onerror = (e) => {
                clearTimeout(timeout);
                // Will fall through to onclose
            };
        });
    }

    /**
     * Local simulation when no WebSocket server is available
     * Uses BroadcastChannel for cross-tab communication (dev only)
     */
    function simulateConnection() {
        return new Promise((resolve) => {
            // Create a simple local-room system using BroadcastChannel
            if (!window._localMP) {
                window._localMP = {
                    channel: null,
                    callbacks: {}
                };
            }

            connected = true;
            emit('connectionChange', { state: 'connected' });

            // Set up channel listener
            try {
                window._localMP.channel = new BroadcastChannel('tictactoe');
                window._localMP.channel.onmessage = (event) => {
                    handleMessage(event.data);
                };
            } catch (e) {
                console.log('BroadcastChannel not supported');
            }

            resolve(true);
        });
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else if (window._localMP && window._localMP.channel) {
            window._localMP.channel.postMessage(data);
        }
    }

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

    function createRoom(playerName) {
        myName = playerName || 'Player';
        send({ type: 'create_room', name: myName });
    }

    function joinRoom(roomCode, playerName) {
        myName = playerName || 'Player';
        send({ type: 'join_room', roomId: roomCode.toUpperCase(), name: myName });
    }

    function sendMove(cellIndex) {
        send({ type: 'move', cell: cellIndex, roomId: myRoom });
    }

    function requestRematch() {
        send({ type: 'rematch_request', roomId: myRoom });
    }

    function acceptRematch() {
        send({ type: 'rematch_accept', roomId: myRoom });
    }

    function leaveRoom() {
        if (myRoom) {
            send({ type: 'leave', roomId: myRoom });
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
