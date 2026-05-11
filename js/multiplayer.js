/**
 * Multiplayer module — handles room creation, joining, move relay, and wagers.
 *
 * Two modes:
 *   1. WebSocket (production) — cross-network play via WS server
 *   2. Local (dev/fallback) — same-origin cross-tab via localStorage events
 *
 * Wager flow:
 *   1. Host sets wager → wager_set message
 *   2. Guest sees wager → confirms → wager_confirm message
 *   3. Both confirmed → wager_locked → game starts
 *   4. Game ends → winner gets pot
 */
const Multiplayer = (() => {
    let ws = null;
    let connected = false;
    let myRoom = null;
    let mySymbol = null;
    let myName = 'Player';
    let useWS = false;
    const listeners = {};

    // Wager state
    let currentWager = 0;
    let hostWagerConfirmed = false;
    let guestWagerConfirmed = false;
    let guestBalance = null;

    const WS_URL = 'ws://' + window.location.host;
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
                try { cb(data); } catch (e) { console.error('MP emit error on ' + event + ':', e); }
            });
        }
    }

    // ===== Wager API =====

    function setWager(amount, hostBalance) {
        currentWager = amount;
        hostWagerConfirmed = true;
        guestWagerConfirmed = false;
        const msg = { type: 'wager_set', roomId: myRoom, amount, hostBalance: hostBalance || 0 };
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        } else {
            localSend(msg);
        }
    }

    function confirmWager() {
        guestWagerConfirmed = true;
        const msg = { type: 'wager_confirm', roomId: myRoom };
        if (useWS && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        } else {
            localSend(msg);
            // In local mode, check if both confirmed
            if (hostWagerConfirmed) {
                emit('wager_locked', { wager: currentWager, pot: currentWager * 2 });
            }
        }
    }

    function getWagerState() {
        return {
            amount: currentWager,
            hostConfirmed: hostWagerConfirmed,
            guestConfirmed: guestWagerConfirmed,
            pot: currentWager * 2,
            guestBalance: guestBalance
        };
    }

    function resetWager() {
        currentWager = 0;
        hostWagerConfirmed = false;
        guestWagerConfirmed = false;
        guestBalance = null;
        myBid = undefined;
        opponentBid = undefined;
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

            try { ws = new WebSocket(WS_URL); }
            catch (e) { startLocalMode('WebSocket constructor failed: ' + e.message); return; }

            const timeout = setTimeout(() => {
                if (!resolved) {
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
            case 'wager_set':
                if (mySymbol === 'O' && myRoom === msg.roomId) {
                    currentWager = msg.amount;
                    hostWagerConfirmed = true;
                    guestBalance = msg.hostBalance || 0;
                    emit('wager_update', { amount: msg.amount, pot: msg.amount * 2, hostConfirmed: true, guestConfirmed: false, hostBalance: msg.hostBalance || 0 });
                }
                break;
            case 'wager_confirm':
                if (mySymbol === 'X' && myRoom === msg.roomId) {
                    guestWagerConfirmed = true;
                    emit('wager_update', { amount: currentWager, pot: currentWager * 2, hostConfirmed: true, guestConfirmed: true });
                    emit('wager_locked', { wager: currentWager, pot: currentWager * 2 });
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
                resetWager();
                emit('roomCreated', { roomId: msg.roomId, symbol: 'X' });
                break;
            case 'room_joined':
                myRoom = msg.roomId;
                mySymbol = msg.symbol;
                resetWager();
                emit('roomJoined', { roomId: msg.roomId, symbol: msg.symbol, hostName: msg.hostName, hostBalance: msg.hostBalance });
                break;
            case 'join_failed':
                emit('joinFailed', { reason: msg.reason });
                break;
            case 'opponent_joined':
                emit('opponentJoined', { name: msg.name, balance: msg.balance });
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
            // ===== Blind Bid Wager Messages =====
            case 'bid_locked':
                // Opponent has locked their bid
                emit('opponentBidLocked', {});
                break;
            case 'bid_reveal':
                // Both bids revealed: { yourBid, opponentBid, finalWager, pot, bonus }
                emit('bidReveal', {
                    yourBid: msg.yourBid,
                    opponentBid: msg.opponentBid,
                    finalWager: msg.finalWager,
                    pot: msg.pot,
                    bonus: msg.bonus || false
                });
                break;
            case 'bid_veto':
                // A player vetoed — play free game
                emit('bidVeto', { vetoedBy: msg.vetoedBy });
                break;
            case 'bid_start':
                // Both players ready, start the game
                currentWager = msg.wager;
                emit('wager_locked', { wager: msg.wager, pot: msg.pot });
                break;
            case 'error':
                emit('error', { message: msg.message });
                break;
            default:
                emit(msg.type, msg);
        }
    }

    function send(data) { // Existing send function
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
        resetWager();
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
        resetWager();
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

    function sendBid(amount) {
        if (useWS) {
            send({ type: 'place_bid', roomId: myRoom, amount });
        } else {
            localSend({ type: 'place_bid', roomId: myRoom, amount });
        }
    }

    function sendVeto() {
        if (useWS) {
            send({ type: 'veto_bid', roomId: myRoom });
        } else {
            localSend({ type: 'veto_bid', roomId: myRoom });
        }
    }

    function sendBidStart() {
        if (useWS) {
            send({ type: 'bid_start', roomId: myRoom });
        } else {
            localSend({ type: 'bid_start', roomId: myRoom });
        }
    }

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
            resetWager();
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
        sendBid, sendVeto, sendBidStart,
        setWager, confirmWager, getWagerState, resetWager,
        isConnected, getRoom, getSymbol, getName
    };
})();
