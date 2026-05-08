/**
 * Main entry point
 * Orchestrates all modules
 *
 * SHOULD-DO FIXES APPLIED:
 * 8.  Rematch keeps room alive, updates CG room data for invite continuity
 * 9.  Sound effects (click, win, lose, draw) using Web Audio API
 * 10. Username display from CG user module
 * 11. Opponent disconnect modal with rematch/menu actions
 * 12. ByteBrew analytics integration
 */
(function() {
    // ===== State =====
    let isMultiplayer = false;
    let mySymbol = null;
    let adPaused = false;
    let joinRoomCallback = null;
    let audioContext = null;
    let bytebrewReady = false;

    // ===================================================================
    // Fix 9: Sound Effects (Web Audio API — no external files needed)
    // ===================================================================
    const Sound = (() => {
        let ctx = null;
        let muted = false;

        function ensureContext() {
            if (!ctx) {
                try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
            }
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
            return ctx;
        }

        function playTone(freq, duration, type, vol) {
            if (muted) return;
            const c = ensureContext();
            if (!c) return;
            try {
                const osc = c.createOscillator();
                const gain = c.createGain();
                osc.type = type || 'sine';
                osc.frequency.setValueAtTime(freq, c.currentTime);
                gain.gain.setValueAtTime(vol || 0.15, c.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
                osc.connect(gain);
                gain.connect(c.destination);
                osc.start(c.currentTime);
                osc.stop(c.currentTime + duration);
            } catch (e) {}
        }

        function playClick()  { playTone(600, 0.08, 'square', 0.08); }
        function playWin()   { playTone(523, 0.15, 'sine', 0.12); setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 150); setTimeout(() => playTone(784, 0.25, 'sine', 0.15), 300); }
        function playLose()  { playTone(300, 0.2, 'sawtooth', 0.08); setTimeout(() => playTone(250, 0.3, 'sawtooth', 0.08), 200); }
        function playDraw()  { playTone(440, 0.15, 'triangle', 0.1); setTimeout(() => playTone(440, 0.15, 'triangle', 0.1), 200); setTimeout(() => playTone(440, 0.3, 'triangle', 0.1), 400); }
        function toggleMute() { muted = !muted; return muted; }
        function isMuted() { return muted; }

        return { playClick, playWin, playLose, playDraw, toggleMute, isMuted, ensureContext };
    })();

    // ===================================================================
    // Fix 12: ByteBrew Analytics
    // ===================================================================
    function initByteBrew() {
        // ByteBrew SDK — loads async, initialize if available
        // Replace YOUR_GAME_ID with your actual ByteBrew game ID after registering
        const BYTEBREW_GAME_ID = '07qjah_u6';
        const BYTEBREW_API_KEY = '4FeOqvSn6LqB7Qnow93kff5v4BXkj/1q8UJgu8Iw3UJJFP0QW4fJpT5UGL98/aFb';

        if (!BYTEBREW_GAME_ID || !BYTEBREW_API_KEY) {
            console.log('ByteBrew: No credentials set — analytics disabled');
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://web.sdk.bytebrew.io/bytebrew.js';
        script.async = true;
        script.onload = function() {
            try {
                if (window.ByteBrew) {
                    window.ByteBrew.Init(BYTEBREW_GAME_ID, BYTEBREW_API_KEY);
                    bytebrewReady = true;
                    console.log('ByteBrew initialized');
                }
            } catch (e) { console.log('ByteBrew init error:', e); }
        };
        script.onerror = function() { console.log('ByteBrew SDK failed to load'); };
        document.head.appendChild(script);
    }

    function trackEvent(eventName, params) {
        if (bytebrewReady && window.ByteBrew) {
            try { window.ByteBrew.CustomEvent(eventName, params || {}); } catch (e) {}
        }
    }

    // ===================================================================
    // Ad Lifecycle Hooks
    // ===================================================================
    window.onAdStarted = function() {
        adPaused = true;
        CG.gameplayStop();
        UI.showAdOverlay();
    };

    window.onAdFinished = function() {
        adPaused = false;
        UI.hideAdOverlay();
        if (UI.getCurrentScreen() === 'game') {
            CG.gameplayStart();
        }
    };

    // ===================================================================
    // iOS Audio Resume
    // ===================================================================
    function setupIOSAudioResume() {
        if (!audioContext) {
            try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
        }
        const resume = () => {
            if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        };
        document.addEventListener('touchend', resume, { passive: true });
        document.addEventListener('click', resume, { passive: true });
    }

    // ===================================================================
    // Initialization
    // ===================================================================
    async function init() {
        // Fix 13: Sitelock — redirect if not on allowed domain
        if (typeof Sitelock !== "undefined" && !Sitelock.enforce()) return;
        setupIOSAudioResume();
        CG.loadingStart();
        UI.setLoadingText('Initializing...');
        UI.setLoadingProgress(10);

        // Fix 12: Initialize ByteBrew
        initByteBrew();

        UI.setLoadingProgress(40);
        await CG.init();

        // Fix 10: Display CG username
        const username = CG.getUsername();
        if (username) {
            UI.setUserInfo(`Playing as: ${username}`);
        } else {
            UI.setUserInfo('Guest Player');
        }

        // Check invite / instant MP
        const inviteParams = CG.getInviteParams();
        const inviteRoomId = inviteParams && (inviteParams.roomId || inviteParams.room);
        const instantMP = CG.isInstantMultiplayer();

        UI.setLoadingText('Connecting to server...');
        UI.setLoadingProgress(60);
        UI.setLoadingProgress(80);
        await Multiplayer.connect();
        setupMultiplayerListeners();

        UI.setLoadingProgress(100);
        CG.loadingStop();

        if (inviteRoomId) {
            UI.showScreen('lobby');
            Multiplayer.joinRoom(inviteRoomId, username || 'Player');
        } else if (instantMP) {
            UI.showScreen('lobby');
            Multiplayer.createRoom(username || 'Player');
        } else {
            UI.showScreen('menu');
        }

        // Fix 12: Track game start
        trackEvent('game_loaded', { mode: 'menu' });
    }

    // ===================================================================
    // UI Event Handlers
    // ===================================================================
    function setupUIListeners() {
        UI.onButton('single', () => {
            isMultiplayer = false;
            startGame(false);
            trackEvent('game_start', { mode: 'single' });
        });

        UI.onButton('create', () => {
            isMultiplayer = true;
            UI.showScreen('lobby');
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
            trackEvent('room_created');
        });

        UI.onButton('join', () => UI.toggleJoinContainer(true));

        UI.onButton('joinConfirm', () => {
            const code = document.getElementById('room-code-input').value.trim();
            if (code.length >= 4) {
                isMultiplayer = true;
                UI.showScreen('lobby');
                const username = CG.getUsername() || 'Player';
                Multiplayer.joinRoom(code, username);
                trackEvent('room_join_attempt', { code });
            }
        });

        UI.onButton('joinCancel', () => UI.toggleJoinContainer(false));

        UI.onButton('copyCode', () => {
            const code = Multiplayer.getRoom();
            if (code) {
                const link = CG.inviteLink({ roomId: code });
                navigator.clipboard.writeText(link).then(() => {
                    const btn = document.getElementById('btn-copy-code');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => btn.textContent = '📋 Copy', 2000);
                }).catch(() => navigator.clipboard.writeText(code));
            }
        });

        UI.onButton('invite', () => {
            const roomId = Multiplayer.getRoom();
            if (roomId) {
                const link = CG.inviteLink({ roomId });
                navigator.clipboard.writeText(link).catch(() => {});
                const btn = document.getElementById('btn-invite');
                btn.textContent = '✅ Link Copied!';
                setTimeout(() => btn.textContent = '👥 Invite Friends', 2000);
                trackEvent('invite_sent', { roomId });
            }
        });

        UI.onButton('leaveLobby', () => {
            cleanupJoinListener();
            Multiplayer.leaveRoom();
            CG.leftRoom();
            isMultiplayer = false;
            mySymbol = null;
            UI.showScreen('menu');
        });

        UI.onButton('backToMenu', () => {
            cleanupJoinListener();
            if (isMultiplayer) {
                Multiplayer.leaveRoom();
                CG.leftRoom();
            }
            CG.gameplayStop();
            isMultiplayer = false;
            mySymbol = null;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.showScreen('menu');
        });

        UI.onButton('rematch', () => {
            if (isMultiplayer) {
                Multiplayer.requestRematch();
                trackEvent('rematch_requested');
            } else {
                TicTacToe.reset();
                UI.clearBoard();
                startGame(false);
                trackEvent('rematch_start', { mode: 'single' });
            }
        });

        UI.onButton('backMenu', () => {
            cleanupJoinListener();
            if (isMultiplayer) {
                Multiplayer.leaveRoom();
                CG.leftRoom();
            }
            CG.gameplayStop();
            isMultiplayer = false;
            mySymbol = null;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.showScreen('menu');
        });

        // Fix 9: Sound toggle
        document.getElementById("btn-sound").addEventListener("click", () => {
            const muted = Sound.toggleMute();
            document.getElementById("btn-sound").textContent = muted ? "🔇" : "🔊";
        });

        // Fix 11: Disconnect modal buttons
        document.getElementById("btn-modal-rematch").addEventListener("click", () => {
            UI.hideDisconnectModal();
            cleanupJoinListener();
            if (isMultiplayer) { Multiplayer.leaveRoom(); CG.leftRoom(); }
            isMultiplayer = false;
            mySymbol = null;
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen("lobby");
            const username = CG.getUsername() || "Player";
            Multiplayer.createRoom(username);
            trackEvent("rematch_after_disconnect");
        });

        document.getElementById("btn-modal-menu").addEventListener("click", () => {
            UI.hideDisconnectModal();
            cleanupJoinListener();
            if (isMultiplayer) { Multiplayer.leaveRoom(); CG.leftRoom(); }
            isMultiplayer = false;
            mySymbol = null;
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen("menu");
        });

        UI.onCellClick((index) => {
            if (adPaused) return;
            Sound.playClick();
            handleMove(index);
        });
    }

    // ===================================================================
    // Fix 3: Cleanup join room listener
    // ===================================================================
    function cleanupJoinListener() {
        if (joinRoomCallback) {
            CG.removeJoinRoomListener(joinRoomCallback);
            joinRoomCallback = null;
        }
    }

    // ===================================================================
    // Multiplayer Event Handlers
    // ===================================================================
    function setupMultiplayerListeners() {
        Multiplayer.on('connectionChange', (data) => {
            UI.setConnectionStatus(data.state);
        });

        Multiplayer.on('roomCreated', (data) => {
            console.log('MP: Room created:', data.roomId);
            UI.setRoomCode(data.roomId);
            mySymbol = 'X';
            // Fix 10: Use CG username for display
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, 'Waiting...');

            CG.updateRoom({
                roomId: data.roomId,
                isJoinable: true,
                inviteParams: { roomId: data.roomId }
            });
        });

        Multiplayer.on('roomJoined', (data) => {
            UI.setRoomCode(data.roomId);
            mySymbol = data.symbol;
            const username = CG.getUsername() || 'Player';
            const hostName = data.hostName || 'Host';
            UI.setPlayerNames(hostName, data.symbol === 'O' ? username : 'Waiting...');

            if (data.symbol === 'O') {
                CG.updateRoom({ roomId: data.roomId, isJoinable: false });
                startGame(true);
            }
        });

        Multiplayer.on('joinFailed', (data) => {
            console.log('Join failed:', data.reason);
            UI.setPlayerNames('Error: ' + data.reason, '');
            setTimeout(() => UI.showScreen('menu'), 2000);
        });

        Multiplayer.on('opponentJoined', (data) => {
            // Fix 10: Show CG username
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, data.name);
            startGame(true);
        });

        // Fix 11: Opponent disconnect modal
        Multiplayer.on('opponentLeft', () => {
            UI.setConnectionStatus('disconnected');
            if (UI.getCurrentScreen() === 'game') {
                CG.gameplayStop();
                UI.showDisconnectModal();
            }
            trackEvent('opponent_disconnected');
        });

        Multiplayer.on('move', (data) => {
            if (adPaused) return;
            const result = TicTacToe.applyRemoteMove(data.cell, data.player);
            updateGameUI();
            if (result && (result.win || result.draw)) {
                handleGameEnd(result);
            }
        });

        Multiplayer.on('rematchRequested', () => {
            Multiplayer.acceptRematch();
        });

        // Fix 8: Rematch accepted — keep room alive, update CG room
        Multiplayer.on('rematchAccepted', () => {
            TicTacToe.reset();
            UI.clearBoard();
            // Fix 8: Update CG room so friends can still join during rematch
            if (isMultiplayer && mySymbol === 'X') {
                const roomId = Multiplayer.getRoom();
                if (roomId) {
                    CG.updateRoom({
                        roomId,
                        isJoinable: true,
                        inviteParams: { roomId }
                    });
                }
            }
            startGame(isMultiplayer);
            trackEvent('rematch_accepted', { mode: isMultiplayer ? 'multi' : 'single' });
        });

        // Fix 3: Store callback for cleanup
        joinRoomCallback = (inviteParams) => {
            const roomId = inviteParams.roomId || inviteParams.room;
            if (roomId && !Multiplayer.getRoom()) {
                isMultiplayer = true;
                UI.showScreen('lobby');
                const username = CG.getUsername() || 'Player';
                Multiplayer.joinRoom(roomId, username);
            }
        };
        CG.addJoinRoomListener(joinRoomCallback);
    }

    // ===================================================================
    // Game Logic
    // ===================================================================
    function startGame(multiplayer) {
        TicTacToe.reset();
        UI.clearBoard();

        // Fix 10: Use CG username
        const username = CG.getUsername() || 'Player';
        if (multiplayer) {
            const xName = mySymbol === 'X' ? username : 'Opponent';
            const oName = mySymbol === 'O' ? username : 'Opponent';
            UI.setGameInfo(xName, oName, true);
        } else {
            UI.setGameInfo('Player X', 'Player O', false);
        }

        UI.setTurnIndicator('X', mySymbol, multiplayer);
        UI.showScreen('game');
        CG.gameplayStart();
    }

    function handleMove(cellIndex) {
        if (TicTacToe.isGameOver()) return;
        if (adPaused) return;

        const currentPlayer = TicTacToe.getCurrentPlayer();
        if (isMultiplayer && currentPlayer !== mySymbol) return;

        const result = TicTacToe.makeMove(cellIndex, currentPlayer);
        if (!result.success) return;

        if (isMultiplayer) Multiplayer.sendMove(cellIndex, currentPlayer);

        updateGameUI();

        if (result.win) {
            CG.happyTime();
            Sound.playWin();
            trackEvent('game_end', { result: 'win', mode: isMultiplayer ? 'multi' : 'single' });
            handleGameEnd(result);
        } else if (result.draw) {
            Sound.playDraw();
            trackEvent('game_end', { result: 'draw', mode: isMultiplayer ? 'multi' : 'single' });
            handleGameEnd(result);
        }
    }

    function updateGameUI() {
        const board = TicTacToe.getBoard();
        const winLine = TicTacToe.getWinLine();
        const currentPlayer = TicTacToe.getCurrentPlayer();
        UI.renderBoard(board, winLine);
        UI.setTurnIndicator(currentPlayer, mySymbol, isMultiplayer);
    }

    function handleGameEnd(result) {
        CG.gameplayStop();

        // Fix 9: Play lose sound for the loser
        if (isMultiplayer && result.winner && result.winner !== mySymbol) {
            Sound.playLose();
        }

        setTimeout(async () => {
            await CG.requestAd('midgame');

            const winner = result.winner || null;
            UI.showGameOverForResult(winner, isMultiplayer, mySymbol);

            // Fix 8: Update room to joinable for rematch
            if (isMultiplayer) {
                const roomId = Multiplayer.getRoom();
                if (roomId) {
                    CG.updateRoom({
                        roomId,
                        isJoinable: true,
                        inviteParams: { roomId }
                    });
                }
            }
        }, 1000);
    }

    // ===================================================================
    // Start
    // ===================================================================
    document.addEventListener('DOMContentLoaded', () => {
        setupUIListeners();
        init().catch(e => {
            console.error('Init error:', e);
            UI.setLoadingText('Error loading. Retrying...');
            setTimeout(init, 2000);
        });
    });
})();
