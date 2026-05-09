/**
 * Main entry point — orchestrates all modules
 * 
 * Wager flow for multiplayer:
 * 1. Host clicks "Create Room" → goes to wager screen
 * 2. Host sets wager amount, confirms → goes to lobby
 * 3. Guest joins → sees wager screen with host's amount
 * 4. Guest confirms wager → both locked → game starts
 * 5. Winner gets pot, loser loses wager
 * 6. Rematch → goes back to wager screen
 */
(function() {
    // ===== State =====
    let isMultiplayer = false;
    let mySymbol = null;
    let adPaused = false;
    let joinRoomCallback = null;
    let audioContext = null;
    let bytebrewReady = false;
    let currentWager = 0;
    let currentPot = 0;

    // ===================================================================
    // Sound Effects
    // ===================================================================
    const Sound = (() => {
        let ctx = null;
        let muted = false;

        function ensureContext() {
            if (!ctx) {
                try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
            }
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
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
        function playCoin()  { playTone(880, 0.1, 'sine', 0.1); setTimeout(() => playTone(1100, 0.15, 'sine', 0.12), 100); }
        function toggleMute() { muted = !muted; return muted; }
        function isMuted() { return muted; }

        return { playClick, playWin, playLose, playDraw, playCoin, toggleMute, isMuted, ensureContext };
    })();

    // ===================================================================
    // ByteBrew Analytics
    // ===================================================================
    function initByteBrew() {
        const BYTEBREW_GAME_ID = '07qjah_u6';
        const BYTEBREW_API_KEY = '4FeOqvSn6LqB7Qnow93kff5v4BXkj/1q8UJgu8Iw3UJJFP0QW4fJpT5UGL98/aFb';

        if (!BYTEBREW_GAME_ID || !BYTEBREW_API_KEY) return;

        const script = document.createElement('script');
        script.src = 'https://web.sdk.bytebrew.io/bytebrew.js';
        script.async = true;
        script.onload = function() {
            try {
                if (window.ByteBrew) {
                    window.ByteBrew.Init(BYTEBREW_GAME_ID, BYTEBREW_API_KEY);
                    bytebrewReady = true;
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
    // Ad Lifecycle
    // ===================================================================
    window.onAdStarted = function() {
        adPaused = true;
        CG.gameplayStop();
        UI.showAdOverlay();
    };

    window.onAdFinished = function() {
        adPaused = false;
        UI.hideAdOverlay();
        if (UI.getCurrentScreen() === 'game') CG.gameplayStart();
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
        if (typeof Sitelock !== 'undefined' && !Sitelock.enforce()) return;
        setupIOSAudioResume();
        CG.loadingStart();
        UI.setLoadingText('Initializing...');
        UI.setLoadingProgress(10);

        initByteBrew();

        // Init wager system
        await Wager.init();
        UI.updateCoinDisplay(Wager.getBalance());

        UI.setLoadingProgress(40);
        await CG.init();

        const username = CG.getUsername();
        if (username) {
            UI.setUserInfo(`Playing as: ${username}`);
        } else {
            UI.setUserInfo('Guest Player');
        }

        const inviteParams = CG.getInviteParams();
        const inviteRoomId = inviteParams && (inviteParams.roomId || inviteParams.room);
        const instantMP = CG.isInstantMultiplayer();

        UI.setLoadingText('Connecting to server...');
        UI.setLoadingProgress(60);
        await Multiplayer.connect();
        setupMultiplayerListeners();
        UI.setLoadingProgress(100);
        CG.loadingStop();

        if (inviteRoomId) {
            isMultiplayer = true;
            UI.showScreen('lobby');
            Multiplayer.joinRoom(inviteRoomId, username || 'Player');
        } else if (instantMP) {
            isMultiplayer = true;
            UI.showScreen('lobby');
            Multiplayer.createRoom(username || 'Player');
        } else {
            UI.showScreen('menu');
        }

        trackEvent('game_loaded', { mode: 'menu' });
    }

    // ===================================================================
    // UI Event Handlers
    // ===================================================================
    function setupUIListeners() {
        // Single player — no wager
        UI.onButton('single', () => {
            isMultiplayer = false;
            currentWager = 0;
            currentPot = 0;
            startGame(false);
            trackEvent('game_start', { mode: 'single' });
        });

        // Create room → go to lobby (wager screen shows after opponent joins)
        UI.onButton('create', () => {
            isMultiplayer = true;
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
            UI.showScreen('lobby');
            trackEvent('room_created');
        });

        // Join room → go to lobby first, then wager screen when room data arrives
        UI.onButton('join', () => UI.toggleJoinContainer(true));

        UI.onButton('joinConfirm', () => {
            const code = document.getElementById('room-code-input').value.trim();
            if (code.length >= 4) {
                isMultiplayer = true;
                UI.showScreen('lobby');
                const username = CG.getUsername() || 'Player';
                console.log('JOIN: Attempting to join room', code);
                Multiplayer.joinRoom(code, username);
                trackEvent('room_join_attempt', { code });
            } else {
                console.log('JOIN: Code too short');
            }
        });

        UI.onButton('joinCancel', () => UI.toggleJoinContainer(false));

        UI.onButton('copyCode', () => {
            const code = Multiplayer.getRoom();
            if (code) {
                const link = CG.inviteLink({ roomId: code });
                copyToClipboard(link, code);
            }
        });

        // Helper: copy text with fallback for non-HTTPS contexts
        function copyToClipboard(primary, fallback) {
            const btn = document.getElementById('btn-copy-code');
            const showCopied = () => {
                btn.textContent = '✅ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy', 2000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(primary).then(showCopied).catch(() => {
                    navigator.clipboard.writeText(fallback).then(showCopied).catch(() => fallbackCopy(primary, fallback, showCopied));
                });
            } else {
                fallbackCopy(primary, fallback, showCopied);
            }
        }

        function fallbackCopy(primary, fallback, onSuccess) {
            try {
                const ta = document.createElement('textarea');
                ta.value = primary;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                onSuccess();
            } catch (e) {
                // Last resort: try fallback text
                try {
                    const ta = document.createElement('textarea');
                    ta.value = fallback;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    onSuccess();
                } catch (e2) {
                    console.log('COPY: Failed to copy to clipboard');
                }
            }
        }

        UI.onButton('invite', () => {
            const roomId = Multiplayer.getRoom();
            if (roomId) {
                const link = CG.inviteLink({ roomId });
                const btn = document.getElementById('btn-invite');
                const tryFallbackCopy = () => {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = link;
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    } catch (e) {
                        console.log('INVITE: Failed to copy to clipboard');
                    }
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(link).catch(tryFallbackCopy);
                } else {
                    tryFallbackCopy();
                }
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
            currentWager = 0;
            currentPot = 0;
            UI.clearLobbyWager();
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
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.showScreen('menu');
        });

        // Rematch → go to wager screen (not straight to game)
        UI.onButton('rematch', () => {
            if (isMultiplayer) {
                // For multiplayer, go back to wager screen
                TicTacToe.reset();
                UI.clearBoard();
                const username = CG.getUsername() || 'Player';
                Multiplayer.createRoom(username);
                showWagerScreen(true);
                trackEvent('rematch_new_wager');
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
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.showScreen('menu');
        });

        // Wager screen buttons
        UI.onButton('wagerConfirm', () => {
            const amount = UI.getWagerAmount();
            if (!Wager.isValidWager(amount)) {
                UI.showWagerWarning(`Minimum wager is ${Wager.getMinWager()} coins`);
                return;
            }
            if (amount > Wager.getBalance()) {
                UI.showWagerWarning('Not enough coins!');
                return;
            }

            currentWager = amount;
            currentPot = amount * 2;

            if (mySymbol === 'X') {
                // Host sets wager — deduct host's coins, go back to lobby to wait
                const deducted = Wager.deductWager(amount);
                if (!deducted) {
                    UI.showWagerWarning('Not enough coins!');
                    return;
                }
                Multiplayer.setWager(amount, Wager.getBalance());
                UI.updateCoinDisplay(Wager.getBalance());
                UI.setLobbyWager(amount, amount * 2);
                UI.setGameWager(amount * 2);
                UI.showLobbyWaiting('Waiting for opponent to confirm wager...');
                UI.showScreen('lobby');
            } else {
                // Guest confirms wager — deduct guest's coins
                const deducted = Wager.deductWager(amount);
                if (!deducted) {
                    UI.showWagerWarning('Not enough coins!');
                    return;
                }
                Multiplayer.confirmWager();
                UI.updateCoinDisplay(Wager.getBalance());
            }
        });

        // Wager screen copy room code
        document.getElementById('btn-wager-copy').addEventListener('click', () => {
            const code = Multiplayer.getRoom();
            if (code) {
                const link = CG.inviteLink({ roomId: code });
                const btn = document.getElementById('btn-wager-copy');
                const showCopied = () => {
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => btn.textContent = '📋 Copy', 2000);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(link).then(showCopied).catch(() => {
                        navigator.clipboard.writeText(code).then(showCopied).catch(() => {
                            // Fallback: execCommand
                            try {
                                const ta = document.createElement('textarea');
                                ta.value = link;
                                ta.style.position = 'fixed';
                                ta.style.left = '-9999px';
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                                showCopied();
                            } catch (e) {
                                console.log('WAGER COPY: Failed to copy');
                            }
                        });
                    });
                } else {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = link;
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        showCopied();
                    } catch (e) {
                        console.log('WAGER COPY: Failed to copy');
                    }
                }
            }
        });

        UI.onButton('wagerCoins', async () => {
            const result = await Wager.earnCoinsFromAd();
            if (result.success) {
                UI.updateCoinDisplay(Wager.getBalance());
                UI.pulseCoinHud();
                Sound.playCoin();
                // Update slider max
                const maxWager = Wager.getMaxWager();
                document.getElementById('wager-slider').max = maxWager;
                document.getElementById('wager-host-balance').textContent = `💰 ${Wager.formatCoins(Wager.getBalance())}`;
                trackEvent('coins_earned', { amount: result.earned });
            } else if (result.reason === 'cooldown') {
                UI.showAdCooldown(result.remaining);
            } else {
                UI.showWagerWarning('Ad not available. Try again later.');
            }
        });

        UI.onButton('wagerBack', () => {
            Multiplayer.leaveRoom();
            isMultiplayer = false;
            mySymbol = null;
            currentWager = 0;
            currentPot = 0;
            UI.showScreen('menu');
        });

        // Sound toggle
        document.getElementById('btn-sound').addEventListener('click', () => {
            const muted = Sound.toggleMute();
            document.getElementById('btn-sound').textContent = muted ? '🔇' : '🔊';
        });

        // Disconnect modal
        document.getElementById('btn-modal-rematch').addEventListener('click', () => {
            UI.hideDisconnectModal();
            cleanupJoinListener();
            if (isMultiplayer) { Multiplayer.leaveRoom(); CG.leftRoom(); }
            isMultiplayer = false;
            mySymbol = null;
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
            showWagerScreen(true);
        });

        document.getElementById('btn-modal-menu').addEventListener('click', () => {
            UI.hideDisconnectModal();
            cleanupJoinListener();
            if (isMultiplayer) { Multiplayer.leaveRoom(); CG.leftRoom(); }
            isMultiplayer = false;
            mySymbol = null;
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen('menu');
        });

        UI.onCellClick((index) => {
            if (adPaused) return;
            Sound.playClick();
            handleMove(index);
        });
    }

    // ===================================================================
    // Wager Screen
    // ===================================================================
    function showWagerScreen(isHost, hostWagerAmount, hostBalance) {
        const username = CG.getUsername() || 'Player';
        const balance = Wager.getBalance();

        if (isHost) {
            const maxWager = Wager.getMaxWager(balance);
            UI.setWagerScreen(username, balance, 'Waiting...', null, maxWager, false);
            UI.showWagerWarning('');
        } else {
            const maxWager = Math.min(balance, hostWagerAmount || balance);
            UI.setWagerScreen(username, balance, 'Host', hostBalance || 0, maxWager, true);
            if (balance < hostWagerAmount) {
                UI.showWagerWarning('Not enough coins! Get more coins to join.');
            } else {
                UI.showWagerWarning('');
            }
        }
        // Show room code on wager screen
        const roomCode = Multiplayer.getRoom();
        if (roomCode) UI.setWagerRoomCode(roomCode);
        UI.showAdCooldown(Wager.getAdCooldownRemaining());
        UI.showScreen('wager');
    }

    // ===================================================================
    // Cleanup
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
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, 'Waiting...');
            CG.updateRoom({
                roomId: data.roomId,
                isJoinable: true,
                inviteParams: { roomId: data.roomId }
            });
            // Don't go to wager screen here — it's already shown in the create button handler
        });

        Multiplayer.on('roomJoined', (data) => {
            console.log('JOIN: Successfully joined room', data.roomId);
            UI.setRoomCode(data.roomId);
            mySymbol = data.symbol;
            const username = CG.getUsername() || 'Player';
            const hostName = data.hostName || 'Host';
            UI.setPlayerNames(hostName, data.symbol === 'O' ? username : 'Waiting...');
            CG.updateRoom({ roomId: data.roomId, isJoinable: false });
            // Guest: hide pre-join lobby UI (room code, invite) since we're already in the room
            if (data.symbol === 'O') {
                UI.setLobbyJoinedState(true);
            }
        });

        Multiplayer.on('joinFailed', (data) => {
            console.log('JOIN: Failed -', data.reason);
            UI.setPlayerNames('Error: ' + data.reason, '');
            setTimeout(() => UI.showScreen('menu'), 2000);
        });

        Multiplayer.on('opponentJoined', (data) => {
            console.log('JOIN: Opponent joined:', data.name, 'mySymbol:', mySymbol);
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, data.name);
            if (mySymbol === 'X') {
                console.log('JOIN: Host showing wager screen');
                showWagerScreen(true);
            } else {
                console.log('JOIN: Guest waiting for wager');
                UI.setLobbyJoinedState(true);
                UI.showLobbyWaiting('Waiting for host to set wager...');
            }
        });

        // Wager events
        Multiplayer.on('wager_update', (data) => {
            currentWager = data.amount;
            currentPot = data.pot;
            if (mySymbol === 'O') {
                UI.hideLobbyWaiting();
                // Guest sees wager screen with host's amount
                const balance = Wager.getBalance();
                const maxWager = Math.min(balance, data.amount);
                // Update slider for guest (must match host's wager)
                const slider = document.getElementById('wager-slider');
                slider.value = data.amount;
                slider.max = maxWager;
                slider.min = data.amount;
                UI.updateWagerDisplay();
                showWagerScreen(false, data.amount, data.hostBalance || 0);
            }
            UI.setGameWager(data.pot);
        });

        Multiplayer.on('wager_locked', (data) => {
            currentWager = data.wager;
            currentPot = data.pot;
            UI.hideLobbyWaiting();
            UI.setLobbyWager(data.wager, data.pot);
            UI.setGameWager(data.pot);
            startGame(true);
        });

        Multiplayer.on('opponentLeft', () => {
            UI.setConnectionStatus('disconnected');
            if (UI.getCurrentScreen() === 'game') {
                CG.gameplayStop();
                // Opponent left mid-game — refund wager
                if (currentWager > 0) {
                    Wager.refundWager(currentWager);
                    UI.updateCoinDisplay(Wager.getBalance());
                }
                UI.showDisconnectModal();
            } else if (UI.getCurrentScreen() === 'lobby' || UI.getCurrentScreen() === 'wager') {
                // Opponent left during wager — refund if coins were deducted
                if (currentWager > 0) {
                    Wager.refundWager(currentWager);
                    UI.updateCoinDisplay(Wager.getBalance());
                }
                currentWager = 0;
                currentPot = 0;
                UI.clearLobbyWager();
                UI.hideLobbyWaiting();
                UI.showScreen('menu');
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

        Multiplayer.on('rematchAccepted', () => {
            TicTacToe.reset();
            UI.clearBoard();
            // Rematch goes to wager screen, not straight to game
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
            showWagerScreen(true);
            trackEvent('rematch_accepted', { mode: 'wager' });
        });

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

        if (isMultiplayer && result.winner && result.winner !== mySymbol) {
            Sound.playLose();
        }

        // Handle wager win/loss
        let coinChange = 0;
        if (isMultiplayer && currentWager > 0) {
            if (result.winner) {
                const iWon = result.winner === mySymbol;
                if (iWon) {
                    coinChange = currentPot;
                    Wager.addWinnings(currentPot);
                    Sound.playCoin();
                    UI.showCoinWinAnimation(currentPot);
                } else {
                    coinChange = -currentWager;
                    Wager.recordLoss(currentWager);
                }
            } else {
                // Draw — refund both
                coinChange = 0;
                Wager.refundWager(currentWager);
            }
            UI.updateCoinDisplay(Wager.getBalance());
            UI.pulseCoinHud();
        }

        updateGameUI();

        setTimeout(async () => {
            await CG.requestAd('midgame');

            const winner = result.winner || null;
            UI.showGameOverForResult(winner, isMultiplayer, mySymbol, coinChange);

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
