/**
 * Main entry point
 * Orchestrates all modules
 */
(function() {
    // ===== State =====
    let isMultiplayer = false;
    let mySymbol = null;
    let adPaused = false;

    // ===== Ad Lifecycle Hooks (global for CG SDK) =====
    window.onAdStarted = function() {
        adPaused = true;
        CG.gameplayStop();
    };

    window.onAdFinished = function() {
        adPaused = false;
        CG.gameplayStart();
    };

    // ===== Initialization =====
    async function init() {
        UI.setLoadingText('Initializing...');

        // Init CrazyGames SDK
        await CG.init();

        // Show user info
        const username = CG.getUsername();
        if (username) {
            UI.setUserInfo(`Playing as: ${username}`);
        }

        // Check for invite params (join link)
        const inviteParams = CG.getInviteParams();
        const inviteRoomId = inviteParams && (inviteParams.roomId || inviteParams.room);

        // Check instant multiplayer
        const instantMP = CG.isInstantMultiplayer();

        // Connect to multiplayer server
        UI.setLoadingText('Connecting to server...');
        await Multiplayer.connect();

        // Setup event listeners
        setupMultiplayerListeners();

        // Check if we should auto-join or go to menu
        if (inviteRoomId) {
            // Join via invite link
            UI.showScreen('lobby');
            Multiplayer.joinRoom(inviteRoomId, username || 'Player');
        } else if (instantMP) {
            // Instant multiplayer — create room
            UI.showScreen('lobby');
            Multiplayer.createRoom(username || 'Player');
        } else {
            UI.showScreen('menu');
        }

        CG.gameplayStart();
    }

    // ===== UI Event Handlers =====

    function setupUIListeners() {
        // Single player
        UI.onButton('single', () => {
            isMultiplayer = false;
            startGame(false);
        });

        // Create room
        UI.onButton('create', async () => {
            isMultiplayer = true;
            UI.showScreen('lobby');
            const username = CG.getUsername() || 'Player';
            Multiplayer.createRoom(username);
        });

        // Join room toggle
        UI.onButton('join', () => {
            UI.toggleJoinContainer(true);
        });

        // Join confirm
        UI.onButton('joinConfirm', () => {
            const code = document.getElementById('room-code-input').value.trim();
            if (code.length >= 4) {
                isMultiplayer = true;
                UI.showScreen('lobby');
                const username = CG.getUsername() || 'Player';
                Multiplayer.joinRoom(code, username);
            }
        });

        // Join cancel
        UI.onButton('joinCancel', () => {
            UI.toggleJoinContainer(false);
        });

        // Copy room code
        UI.onButton('copyCode', () => {
            const code = Multiplayer.getRoom();
            if (code) {
                const link = CG.inviteLink({ roomId: code });
                navigator.clipboard.writeText(link).then(() => {
                    const btn = document.getElementById('btn-copy-code');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => btn.textContent = '📋 Copy', 2000);
                }).catch(() => {
                    // Fallback
                    navigator.clipboard.writeText(code);
                });
            }
        });

        // Invite friends
        UI.onButton('invite', () => {
            const roomId = Multiplayer.getRoom();
            if (roomId) {
                const link = CG.inviteLink({ roomId });
                const copied = CG.copyToClipboard ? CG.copyToClipboard(link) : null;
                if (!copied) {
                    navigator.clipboard.writeText(link).catch(() => {});
                }
                const btn = document.getElementById('btn-invite');
                btn.textContent = '✅ Link Copied!';
                setTimeout(() => btn.textContent = '👥 Invite Friends', 2000);
            }
        });

        // Leave lobby
        UI.onButton('leaveLobby', () => {
            Multiplayer.leaveRoom();
            CG.leftRoom();
            UI.showScreen('menu');
        });

        // Back to menu (from game)
        UI.onButton('backToMenu', () => {
            if (isMultiplayer) {
                Multiplayer.leaveRoom();
                CG.leftRoom();
            }
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen('menu');
        });

        // Rematch
        UI.onButton('rematch', () => {
            if (isMultiplayer) {
                Multiplayer.requestRematch();
            } else {
                TicTacToe.reset();
                UI.clearBoard();
                startGame(false);
            }
        });

        // Back to menu (from game over)
        UI.onButton('backMenu', () => {
            if (isMultiplayer) {
                Multiplayer.leaveRoom();
                CG.leftRoom();
            }
            TicTacToe.reset();
            UI.clearBoard();
            UI.showScreen('menu');
        });

        // Cell click
        UI.onCellClick((index) => {
            if (adPaused) return;
            handleMove(index);
        });
    }

    // ===== Multiplayer Event Handlers =====

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

            // Update CrazyGames room
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
                // I joined — update CG room and start the game
                CG.updateRoom({
                    roomId: data.roomId,
                    isJoinable: false
                });
                startGame(true);
            }
        });

        Multiplayer.on('joinFailed', (data) => {
            console.log('Join failed:', data.reason);
            // Show error in lobby then return to menu
            UI.setPlayerNames('Error: ' + data.reason, '');
            setTimeout(() => UI.showScreen('menu'), 2000);
        });

        Multiplayer.on('opponentJoined', (data) => {
            const username = CG.getUsername() || 'Player';
            UI.setPlayerNames(username, data.name);

            // Start the game
            startGame(true);
        });

        Multiplayer.on('opponentLeft', () => {
            // Show notification
            UI.setConnectionStatus('disconnected');
            // Could show a modal here
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
            // Auto-accept rematch request from opponent
            Multiplayer.acceptRematch();
        });

        Multiplayer.on('rematchAccepted', () => {
            TicTacToe.reset();
            UI.clearBoard();
            startGame(true);
        });

        // CrazyGames room join listener
        CG.addJoinRoomListener((inviteParams) => {
            const roomId = inviteParams.roomId || inviteParams.room;
            if (roomId && !Multiplayer.getRoom()) {
                isMultiplayer = true;
                UI.showScreen('lobby');
                const username = CG.getUsername() || 'Player';
                Multiplayer.joinRoom(roomId, username);
            }
        });
    }

    // ===== Game Logic =====

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

        // In multiplayer, only allow my turn
        if (isMultiplayer && currentPlayer !== mySymbol) {
            return;
        }

        const result = TicTacToe.makeMove(cellIndex, currentPlayer);
        if (!result.success) return;

        // Send move to server in multiplayer
        if (isMultiplayer) {
            Multiplayer.sendMove(cellIndex, currentPlayer);
        }

        updateGameUI();

        if (result.win) {
            CG.happyTime();
            handleGameEnd(result);
        } else if (result.draw) {
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

        // Show midgame ad then game over
        setTimeout(async () => {
            await CG.requestAd('midgame');

            const winner = result.winner || null;
            UI.showGameOverForResult(winner, isMultiplayer, mySymbol);

            if (isMultiplayer) {
                // Update room to joinable for rematch
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

    // ===== Start =====
    document.addEventListener('DOMContentLoaded', () => {
        setupUIListeners();
        init().catch(e => {
            console.error('Init error:', e);
            UI.setLoadingText('Error loading. Retrying...');
            setTimeout(init, 2000);
        });
    });
})();
