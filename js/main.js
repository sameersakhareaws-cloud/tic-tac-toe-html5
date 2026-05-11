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
    // ===== Version =====
    const VERSION = 'v1.4.1';
    const versionEl = document.getElementById('version-display');
    if (versionEl) versionEl.textContent = VERSION;

    // ===== State =====
    let isMultiplayer = false;
    let mySymbol = null;
    let adPaused = false;
    let joinRoomCallback = null;
    let audioContext = null;
    let bytebrewReady = false;
    let currentWager = 0;
    let currentPot = 0;
    let rematchRoom = null; // Room code to reuse for rematch (prevents new room creation)
    let opponentBalance = null; // Track opponent's balance for display in wager screen

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
            console.log('FLOW: Create room clicked, username:', username);
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

        UI.onButton('lobbyErrorOk', () => {
            UI.hideLobbyError();
            UI.showScreen('menu');
        });

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
            rematchRoom = null;
            currentWager = 0;
            currentPot = 0;
            opponentBalance = null;
            UI.clearLobbyWager();
            UI.setLobbyJoinedState(false);
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
            rematchRoom = null;
            currentWager = 0;
            currentPot = 0;
            opponentBalance = null;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.setLobbyJoinedState(false);
            UI.showScreen('menu');
        });

        // Rematch — reuse existing room, don't create a new one
        UI.onButton('rematch', () => {
            if (isMultiplayer) {
                TicTacToe.reset();
                UI.clearBoard();
                // Store the room code for rematch reuse
                rematchRoom = Multiplayer.getRoom();
                // Send rematch request on the EXISTING room — no new room created
                Multiplayer.requestRematch();
                // Show waiting state while opponent decides
                UI.showLobbyWaiting('Waiting for opponent to accept rematch...');
                UI.showScreen('lobby');
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
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideDisconnectModal();
            UI.showScreen('menu');
        });

        // Wager screen buttons
        // Blind bid: Lock In button
        UI.onButton('wagerLockin', () => {
            if (bidLocked) return;
            const balance = Wager.getBalance();
            if (myBidAmount < Wager.getMinWager()) {
                UI.showWagerWarning(`Minimum bid is ${Wager.getMinWager()} coins`);
                return;
            }
            if (myBidAmount > balance) {
                UI.showWagerWarning('Not enough coins!');
                return;
            }
            // Lock in the bid
            bidLocked = true;
            Multiplayer.sendBid(myBidAmount);
            showBidWaitingScreen();
            console.log('BID: Locked in bid:', myBidAmount);
        });

        // Reveal phase: Start Game button
        UI.onButton('wagerStart', () => {
            Multiplayer.sendBidStart();
        });

        // Reveal phase: Veto button
        UI.onButton('wagerVeto', () => {
            Multiplayer.sendVeto();
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
                // Update slider max and display
                const balance = Wager.getBalance();
                const slider = document.getElementById('wager-slider');
                slider.max = balance;
                if (myBidAmount > balance) {
                    myBidAmount = balance;
                    slider.value = myBidAmount;
                    document.getElementById('wager-amount-display').textContent = myBidAmount;
                }
                document.getElementById('wager-host-balance').textContent = `💰 ${Wager.formatCoins(balance)}`;
                trackEvent('coins_earned', { amount: result.earned });
            } else if (result.reason === 'cooldown') {
                UI.showAdCooldown(result.remaining);
            } else {
                UI.showAdWarning();
            }
        });

        // Quick bid buttons — set up once, not inside showBlindBidScreen
        document.querySelectorAll('.btn-quick-bid').forEach(btn => {
            btn.addEventListener('click', () => {
                if (bidLocked) return;
                const slider = document.getElementById('wager-slider');
                const amt = btn.dataset.amount;
                if (amt === 'allin') {
                    myBidAmount = Wager.getBalance();
                } else {
                    myBidAmount = parseInt(amt, 10);
                }
                slider.value = myBidAmount;
                document.getElementById('wager-amount-display').textContent = myBidAmount;
                document.querySelectorAll('.btn-quick-bid').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        UI.onButton('wagerBack', () => {
            Multiplayer.leaveRoom();
            isMultiplayer = false;
            mySymbol = null;
            rematchRoom = null;
            currentWager = 0;
            currentPot = 0;
            myBidAmount = 0;
            bidLocked = false;
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
            rematchRoom = null;
            currentWager = 0;
            currentPT = 0;
            myBidAmount = 0;
            bidLocked = false;
            opponentBalance = null;
            TicTacToe.reset();
            UI.clearBoard();
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
            // Room created — showBlindBidScreen will fire on roomCreated event
        });

        document.getElementById('btn-modal-menu').addEventListener('click', () => {
            UI.hideDisconnectModal();
            cleanupJoinListener();
            if (isMultiplayer) { Multiplayer.leaveRoom(); CG.leftRoom(); }
            isMultiplayer = false;
            mySymbol = null;
            rematchRoom = null;
            currentWager = 0;
            currentPot = 0;
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen('menu');
        });

        // Rematch request modal buttons
        UI.onButton('rematchAccept', () => {
            UI.hideRematchRequest();
            TicTacToe.reset();
            UI.clearBoard();
            // Reset wager state for new round
            currentWager = 0;
            currentPot = 0;
            myBidAmount = 0;
            bidLocked = false;
            opponentBalance = null;
            // Accept rematch on the existing room — no new room created
            rematchRoom = Multiplayer.getRoom();
            Multiplayer.acceptRematch();
            trackEvent('rematch_accepted');
        });
        UI.onButton('rematchReject', () => {
            UI.hideRematchRequest();
            // Reject — go back to menu
            cleanupJoinListener();
            Multiplayer.leaveRoom();
            CG.leftRoom();
            isMultiplayer = false;
            mySymbol = null;
            rematchRoom = null;
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
    // Blind Bid Wager Screen
    // ===================================================================
    let myBidAmount = 0;
    let bidLocked = false;

    function showBlindBidScreen() {
    console.log('DEBUG: showBlindBidScreen called');
        const username = CG.getUsername() || 'Player';
        const balance = Wager.getBalance();
        const roomCode = Multiplayer.getRoom();

        // Reset bid state
        myBidAmount = Math.min(50, balance);
        bidLocked = false;

        // Reset reveal phase DOM (in case previous round was a veto)
        resetRevealPhaseDOM();

        // Update player info — use actual opponent name from lobby if available
        document.getElementById('wager-host-name').textContent = username;
        document.getElementById('wager-host-balance').textContent = `💰 ${Wager.formatCoins(balance)}`;
        const oppName = document.getElementById('guest-name').textContent;
        document.getElementById('wager-guest-name').textContent = (oppName && oppName !== 'Waiting...') ? oppName : 'Opponent';
        // Show opponent balance if we have it (from opponentJoined event), otherwise show ---
        document.getElementById('wager-guest-balance').textContent = opponentBalance !== null ? `💰 ${Wager.formatCoins(opponentBalance)}` : '💰 --';
        if (roomCode) document.getElementById('wager-room-code-display').textContent = roomCode;

        // Setup slider
        const slider = document.getElementById('wager-slider');
        slider.min = Wager.getMinWager();
        slider.max = balance;
        slider.step = Wager.getWagerStep();
        slider.value = myBidAmount;
        slider.disabled = false;
        document.getElementById('wager-amount-display').textContent = myBidAmount;

        // Clear active state on quick bid buttons
        document.querySelectorAll('.btn-quick-bid').forEach(btn => {
            btn.classList.remove('active');
        });

        // Slider input
        slider.oninput = () => {
            if (bidLocked) return;
            myBidAmount = parseInt(slider.value, 10);
            document.getElementById('wager-amount-display').textContent = myBidAmount;
            document.querySelectorAll('.btn-quick-bid').forEach(b => b.classList.remove('active'));
        };

        // Show bid phase, hide others
        document.getElementById('wager-bid-phase').classList.remove('hidden');
        document.getElementById('wager-waiting-phase').classList.add('hidden');
        document.getElementById('wager-reveal-phase').classList.add('hidden');

        UI.showWagerWarning('');
        UI.showAdCooldown(Wager.getAdCooldownRemaining());
        console.log('DEBUG: Switching to wager screen');
        UI.showScreen('wager');
    }

    function showBidWaitingScreen() {
        document.getElementById('wager-bid-phase').classList.add('hidden');
        document.getElementById('wager-waiting-phase').classList.remove('hidden');
        document.getElementById('wager-reveal-phase').classList.add('hidden');
    }

    function resetRevealPhaseDOM() {
        // Restore reveal phase to default state (undo any veto modifications)
        document.getElementById('wager-reveal-resolution').innerHTML =
            '<p>Resolution: <strong>Lower bid wins</strong></p>' +
            '<p>Final Wager: <span id="wager-reveal-final" class="wager-reveal-final-amount">--</span> 💰</p>' +
            '<p>Pot: <span id="wager-reveal-pot" class="wager-reveal-pot-amount">--</span> 💰</p>';
        document.getElementById('btn-wager-start').textContent = '🎮 Start Game';
        document.getElementById('btn-wager-veto').classList.remove('hidden');
    }

    function showBidRevealScreen(yourBid, opponentBid, finalWager, pot, bonus) {
        // Always start from clean state
        resetRevealPhaseDOM();

        document.getElementById('wager-bid-phase').classList.add('hidden');
        document.getElementById('wager-waiting-phase').classList.add('hidden');
        document.getElementById('wager-reveal-phase').classList.remove('hidden');

        document.getElementById('wager-reveal-you').textContent = yourBid;
        document.getElementById('wager-reveal-opponent').textContent = opponentBid;
        document.getElementById('wager-reveal-final').textContent = finalWager;
        document.getElementById('wager-reveal-pot').textContent = pot;

        const bonusEl = document.getElementById('wager-reveal-bonus');
        if (bonus) {
            bonusEl.classList.remove('hidden');
        } else {
            bonusEl.classList.add('hidden');
        }
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
            // Host creates a room – store room code in UI and announce balance
            UI.setRoomCode(data.roomId);
            const myBal = Wager.getBalance();
            Multiplayer.send({ type: 'balance_update', balance: myBal });
            // Host creates room – no opponent yet, but keep track of own balance.
            // When opponent joins, we'll send our balance then.

            console.log('MP: Room created:', data.roomId);
            UI.setRoomCode(data.roomId);
            mySymbol = 'X';
            rematchRoom = data.roomId; // Track room for potential rematch
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, 'Waiting...');
            UI.setLobbyJoinedState(false); // Reset lobby to pre-join state (show room code, invite btn)
            CG.updateRoom({
                roomId: data.roomId,
                isJoinable: true,
                inviteParams: { roomId: data.roomId }
            });
            // Don't go to wager screen here — it's already shown in the create button handler
        });

        Multiplayer.on('roomJoined', (data) => {
            // Guest joined a room – after UI setup, send our balance to host
            const myBal = Wager.getBalance();
            Multiplayer.send({ type: 'balance_update', balance: myBal });
            console.log('JOIN: Successfully joined room', data.roomId);
            UI.setRoomCode(data.roomId);
            mySymbol = data.symbol;
            rematchRoom = data.roomId; // Track room for potential rematch
            const username = CG.getUsername() || 'Player';
            const hostName = data.hostName || 'Host';
            UI.setPlayerNames(hostName, data.symbol === 'O' ? username : 'Waiting...');
            // Store host balance for guest UI (hostBalance sent by server)
            if (data.hostBalance !== undefined) {
                opponentBalance = data.hostBalance;
            } else {
                opponentBalance = Wager.getBalance();
            }
            CG.updateRoom({ roomId: data.roomId, isJoinable: false });
            UI.setLobbyJoinedState(true);
            // Guest: show blind bid screen immediately (both players need to bid)
            showBlindBidScreen();
        });

        Multiplayer.on('joinFailed', (data) => {
            console.log('JOIN: Failed -', data.reason);
            const errorMsg = data.reason === 'Room not found'
                ? 'Room not found. The host may have left or the room expired.'
                : data.reason === 'Room is full'
                    ? 'Room is full. Try another room code.'
                    : data.reason || 'Failed to join room.';
            UI.showLobbyError(errorMsg);
        });

        Multiplayer.on('opponentJoined', (data) => {
            console.log('JOIN: Opponent joined:', data.name, 'mySymbol:', mySymbol);
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(`${username} (X)`, `${data.name} (O)`);
            // Store opponent balance for wager screen display
            if (data.balance !== undefined) {
                opponentBalance = data.balance;
            } else {
                // Fallback: assume same balance as local player (starting balances are equal)
                opponentBalance = Wager.getBalance();
            }
            UI.setLobbyJoinedState(true);
            // Both players enter the blind bid screen
            showBlindBidScreen();
        });

        // Blind bid events
        Multiplayer.on('opponentBidLocked', () => {
            console.log('BID: Opponent locked their bid');
            // Show a subtle indicator that opponent has locked
            if (bidLocked) {
                // Both locked — reveal is coming
                document.querySelector('.wager-waiting-text').textContent = 'Opponent locked in! Revealing...';
            }
        });

        Multiplayer.on('bidReveal', (data) => {
            console.log('BID: Reveal — yourBid:', data.yourBid, 'opponentBid:', data.opponentBid, 'final:', data.finalWager);
            currentWager = data.finalWager;
            currentPot = data.pot;
            showBidRevealScreen(data.yourBid, data.opponentBid, data.finalWager, data.pot, data.bonus);
        });

        Multiplayer.on('bidVeto', (data) => {
            console.log('BID: Vetoed by', data.vetoedBy);
            // Veto — play free game (no wager)
            currentWager = 0;
            currentPot = 0;
            // Show veto message on the reveal screen
            document.getElementById('wager-reveal-resolution').innerHTML = '<p>✋ Vetoed! Playing a free game.</p>';
            document.getElementById('wager-reveal-bonus').classList.add('hidden');
            document.getElementById('btn-wager-veto').classList.add('hidden');
            document.getElementById('btn-wager-start').textContent = '🎮 Start Free Game';
            // Auto-start after delay
            setTimeout(() => {
                startGame(true);
            }, 2000);
        });

        // bid_start from server — both players ready, start the game
        Multiplayer.on('wager_locked', (data) => {
            console.log('BID: Wager locked — starting game');
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
                rematchRoom = null;
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
            UI.showRematchRequest();
        });

        Multiplayer.on('rematchAccepted', () => {
            TicTacToe.reset();
            UI.clearBoard();
            UI.hideLobbyWaiting();
            // Reset wager state for new round
            currentWager = 0;
            currentPot = 0;
            myBidAmount = 0;
            bidLocked = false;
            opponentBalance = null;
            // Both players reuse the SAME room — no new room creation
            // The server keeps the room alive, just reset game state
            showBlindBidScreen();
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
            // Deduct wager from both players
            if (currentWager > 0) {
                Wager.deductWager(currentWager);
                UI.updateCoinDisplay(Wager.getBalance());
            }
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
    // Global Error Handler
    // ===================================================================
    window.addEventListener('error', (e) => {
        console.error('GLOBAL ERROR:', e.message, 'at', e.filename + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
        console.error('UNHANDLED PROMISE REJECTION:', e.reason);
    });

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
