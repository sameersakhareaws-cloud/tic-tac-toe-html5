/**
 * UI module — all DOM manipulation and screen transitions
 */
const UI = (() => {
    // Screen elements
    const screens = {
        loading: document.getElementById('loading-screen'),
        menu: document.getElementById('menu-screen'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen'),
        gameover: document.getElementById('gameover-screen')
    };

    // Button elements
    const buttons = {
        single: document.getElementById('btn-single'),
        create: document.getElementById('btn-create'),
        join: document.getElementById('btn-join'),
        joinConfirm: document.getElementById('btn-join-confirm'),
        joinCancel: document.getElementById('btn-join-cancel'),
        copyCode: document.getElementById('btn-copy-code'),
        invite: document.getElementById('btn-invite'),
        leaveLobby: document.getElementById('btn-leave-lobby'),
        backToMenu: document.getElementById('btn-back-to-menu'),
        rematch: document.getElementById('btn-rematch'),
        backMenu: document.getElementById('btn-back-menu')
    };

    // Display elements
    const display = {
        loadingText: document.getElementById('loading-text'),
        userInfo: document.getElementById('user-info'),
        joinContainer: document.getElementById('join-container'),
        roomCodeInput: document.getElementById('room-code-input'),
        roomCode: document.getElementById('room-code'),
        hostName: document.getElementById('host-name'),
        guestName: document.getElementById('guest-name'),
        playerXName: document.getElementById('player-x-name'),
        playerOName: document.getElementById('player-o-name'),
        turnIndicator: document.getElementById('turn-indicator'),
        gameRoomInfo: document.getElementById('game-room-info'),
        gameRoomCode: document.getElementById('game-room-code'),
        resultText: document.getElementById('result-text'),
        resultSubtext: document.getElementById('result-subtext'),
        connStatus: document.getElementById('conn-status'),
        connText: document.getElementById('conn-text'),
        board: document.getElementById('board')
    };

    let buttonCallbacks = {};
    let currentScreenName = 'loading';

    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[name]) {
            screens[name].classList.add('active');
        }
        currentScreenName = name;
    }

    function getCurrentScreen() {
        return currentScreenName;
    }

    // ===== Ad Overlay (Fix 4: full UI block during ads) =====
    function showAdOverlay() {
        const overlay = document.getElementById('ad-overlay');
        if (overlay) overlay.classList.add('active');
    }

    function hideAdOverlay() {
        const overlay = document.getElementById('ad-overlay');
        if (overlay) overlay.classList.remove('active');
    }

    function setLoadingText(text) {
        display.loadingText.textContent = text;
    }

    function setUserInfo(text) {
        display.userInfo.textContent = text;
    }

    function toggleJoinContainer(show) {
        if (show) {
            display.joinContainer.classList.remove('hidden');
            display.roomCodeInput.focus();
        } else {
            display.joinContainer.classList.add('hidden');
            display.roomCodeInput.value = '';
        }
    }

    function setRoomCode(code) {
        display.roomCode.textContent = code;
        display.gameRoomCode.textContent = `Room: ${code}`;
    }

    function setPlayerNames(hostName, guestName) {
        display.hostName.textContent = hostName;
        display.guestName.textContent = guestName;
    }

    function setGameInfo(xName, oName, isMultiplayer) {
        display.playerXName.textContent = xName;
        display.playerOName.textContent = oName;
        display.gameRoomInfo.classList.toggle('hidden', !isMultiplayer);
    }

    function setTurnIndicator(currentPlayer, mySymbol, isMultiplayer) {
        if (isMultiplayer) {
            const isMyTurn = currentPlayer === mySymbol;
            display.turnIndicator.textContent = isMyTurn ? 'Your Turn' : "Opponent's Turn";
            display.turnIndicator.className = `turn-indicator ${currentPlayer.toLowerCase()}-turn`;
        } else {
            display.turnIndicator.textContent = `${currentPlayer}'s Turn`;
            display.turnIndicator.className = `turn-indicator ${currentPlayer.toLowerCase()}-turn`;
        }
    }

    function renderBoard(board, winLine) {
        const cells = display.board.querySelectorAll('.cell');
        cells.forEach((cell, i) => {
            cell.textContent = board[i] || '';
            cell.className = 'cell';
            if (board[i]) {
                cell.classList.add('taken', board[i].toLowerCase());
            }
            if (winLine && winLine.includes(i)) {
                cell.classList.add('win');
            }
        });
    }

    function clearBoard() {
        const cells = display.board.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.textContent = '';
            cell.className = 'cell';
        });
    }

    function setConnectionStatus(state) {
        display.connStatus.classList.remove('hidden', 'connected', 'error');
        switch (state) {
            case 'connected':
                display.connStatus.classList.add('connected');
                display.connText.textContent = 'Connected';
                setTimeout(() => display.connStatus.classList.add('hidden'), 3000);
                break;
            case 'connecting':
                display.connText.textContent = 'Connecting...';
                break;
            case 'disconnected':
                display.connStatus.classList.add('error');
                display.connText.textContent = 'Disconnected';
                break;
        }
    }

    function showGameOver(result, isMultiplayer) {
        if (result.draw) {
            display.resultText.textContent = "It's a Draw!";
            display.resultSubtext.textContent = "Good game!";
        } else if (isMultiplayer) {
            const iWon = result.winner === 'X';
            display.resultText.textContent = iWon ? '🎉 You Win!' : '😔 You Lose';
            display.resultSubtext.textContent = iWon ? 'Great job!' : 'Better luck next time!';
        } else {
            display.resultText.textContent = `Player ${result.winner} Wins!`;
            display.resultSubtext.textContent = 'Congratulations!';
        }
        showScreen('gameover');
    }

    function showGameOverForResult(winner, isMultiplayer, mySymbol) {
        const emoji = document.getElementById('result-emoji');
        if (!winner) {
            display.resultText.textContent = "It's a Draw!";
            display.resultSubtext.textContent = "Good game!";
            emoji.textContent = '🤝';
        } else if (isMultiplayer) {
            const iWon = winner === mySymbol;
            display.resultText.textContent = iWon ? 'You Win!' : 'You Lose';
            display.resultSubtext.textContent = iWon ? 'Great job! 🎮' : 'Better luck next time!';
            emoji.textContent = iWon ? '🏆' : '💔';
        } else {
            display.resultText.textContent = `Player ${winner} Wins!`;
            display.resultSubtext.textContent = 'Congratulations!';
            emoji.textContent = '🎉';
        }
        showScreen('gameover');
    }

    // ===== Event Binding =====

    function onButton(id, callback) {
        buttonCallbacks[id] = callback;
        if (buttons[id]) {
            buttons[id].addEventListener('click', callback);
        }
    }

    function onCellClick(callback) {
        display.board.addEventListener('click', (e) => {
            const cell = e.target.closest('.cell');
            if (cell) {
                const index = parseInt(cell.dataset.index);
                callback(index);
            }
        });
    }

    // Auto-uppercase room code input
    display.roomCodeInput.addEventListener('input', () => {
        display.roomCodeInput.value = display.roomCodeInput.value.toUpperCase();
    });

    // Enter key on room code input
    display.roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            buttons.joinConfirm.click();
        }
    });

    return {
        showScreen,
        getCurrentScreen,
        showAdOverlay,
        hideAdOverlay,
        setLoadingText,
        setUserInfo,
        toggleJoinContainer,
        setRoomCode,
        setPlayerNames,
        setGameInfo,
        setTurnIndicator,
        renderBoard,
        clearBoard,
        setConnectionStatus,
        showGameOver,
        showGameOverForResult,
        onButton,
        setLoadingProgress,
        showDisconnectModal,
        hideDisconnectModal,
        onCellClick
    };
})();

// ===== Disconnect Modal (Fix 11) =====
function showDisconnectModal() {
    const modal = document.getElementById('disconnect-modal');
    if (modal) modal.classList.add('active');
    const emoji = modal.querySelector('.modal-emoji');
    if (emoji) emoji.textContent = '😔';
}

function hideDisconnectModal() {
    const modal = document.getElementById('disconnect-modal');
    if (modal) modal.classList.remove('active');
}

// ===== Loading Progress (Fix 14) =====
function setLoadingProgress(percent) {
    const bar = document.getElementById('loading-progress-bar');
    if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
}
