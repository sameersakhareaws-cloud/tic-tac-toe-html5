/**
 * UI module — all DOM manipulation and screen transitions
 */
const UI = (() => {
    const screens = {
        loading: document.getElementById('loading-screen'),
        menu: document.getElementById('menu-screen'),
        wager: document.getElementById('wager-screen'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen'),
        gameover: document.getElementById('gameover-screen')
    };

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
        backMenu: document.getElementById('btn-back-menu'),
        wagerConfirm: document.getElementById('btn-wager-confirm'),
        wagerCoins: document.getElementById('btn-wager-coins'),
        wagerBack: document.getElementById('btn-wager-back'),
        lobbyErrorOk: document.getElementById('btn-lobby-error-ok')
    };

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
        gamePotAmount: document.getElementById('game-pot-amount'),
        gameWagerInfo: document.getElementById('game-wager-info'),
        resultText: document.getElementById('result-text'),
        resultSubtext: document.getElementById('result-subtext'),
        resultCoins: document.getElementById('result-coins'),
        resultEmoji: document.getElementById('result-emoji'),
        connStatus: document.getElementById('conn-status'),
        connText: document.getElementById('conn-text'),
        board: document.getElementById('board'),
        // Wager screen
        wagerRoomCodeDisplay: document.getElementById('wager-room-code-display'),
        wagerHostName: document.getElementById('wager-host-name'),
        wagerHostBalance: document.getElementById('wager-host-balance'),
        wagerGuestName: document.getElementById('wager-guest-name'),
        wagerGuestBalance: document.getElementById('wager-guest-balance'),
        wagerSlider: document.getElementById('wager-slider'),
        wagerAmountDisplay: document.getElementById('wager-amount-display'),
        wagerPotAmount: document.getElementById('wager-pot-amount'),
        wagerWarning: document.getElementById('wager-warning'),
        wagerAdCooldown: document.getElementById('wager-ad-cooldown'),
        // Lobby wager
        lobbyWagerInfo: document.getElementById('lobby-wager-info'),
        lobbyWagerAmount: document.getElementById('lobby-wager-amount'),
        lobbyPotAmount: document.getElementById('lobby-pot-amount'),
        // Coin HUD
        coinHud: document.getElementById('coin-hud'),
        coinBalance: document.getElementById('coin-balance'),
        // Coin win animation
        coinWinOverlay: document.getElementById('coin-win-overlay'),
        coinWinFlyer: document.getElementById('coin-win-flyer')
    };

    let buttonCallbacks = {};
    let currentScreenName = 'loading';
    let ghostPlayer = 'X';

    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        if (screens[name]) screens[name].classList.add('active');
        currentScreenName = name;

        // Show/hide coin HUD on game screens
        const showHud = ['lobby', 'game', 'wager', 'gameover'].includes(name);
        display.coinHud.classList.toggle('hidden', !showHud);
    }

    function getCurrentScreen() { return currentScreenName; }

    // ===== Ad Overlay =====
    function showAdOverlay() {
        const el = document.getElementById('ad-overlay');
        if (el) el.classList.add('active');
    }
    function hideAdOverlay() {
        const el = document.getElementById('ad-overlay');
        if (el) el.classList.remove('active');
    }

    // ===== Loading =====
    function setLoadingText(text) { display.loadingText.textContent = text; }
    function setUserInfo(text) { display.userInfo.textContent = text; }

    function setLoadingProgress(percent) {
        const bar = document.getElementById('loading-progress-bar');
        if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
    }

    // ===== Coin HUD =====
    function updateCoinDisplay(balance) {
        display.coinBalance.textContent = Wager.formatCoins(balance);
    }

    function pulseCoinHud() {
        display.coinHud.classList.remove('pulse');
        void display.coinHud.offsetWidth; // force reflow
        display.coinHud.classList.add('pulse');
    }

    function showCoinWinAnimation(amount) {
        display.coinWinFlyer.textContent = `+${amount} 💰`;
        display.coinWinOverlay.classList.remove('hidden');
        setTimeout(() => {
            display.coinWinOverlay.classList.add('hidden');
        }, 1500);
    }

    // ===== Join =====
    function toggleJoinContainer(show) {
        if (show) {
            display.joinContainer.classList.remove('hidden');
            display.roomCodeInput.focus();
        } else {
            display.joinContainer.classList.add('hidden');
            display.roomCodeInput.value = '';
        }
    }

    // ===== Wager Screen =====
    function setWagerScreen(hostName, hostBalance, guestName, guestBalance, maxWager, isGuestMode) {
        display.wagerHostName.textContent = hostName;
        display.wagerHostBalance.textContent = `💰 ${Wager.formatCoins(hostBalance)}`;
        display.wagerGuestName.textContent = guestName || 'Waiting...';
        display.wagerGuestBalance.textContent = guestBalance !== null ? `💰 ${Wager.formatCoins(guestBalance)}` : '💰 --';

        // Configure slider
        const slider = display.wagerSlider;
        slider.step = Wager.getWagerStep();

        if (isGuestMode) {
            // Guest must match host's exact wager — slider is locked
            slider.min = maxWager;
            slider.max = maxWager;
            slider.value = maxWager;
            slider.disabled = true;
        } else {
            // Host sets the wager freely
            slider.min = Wager.getMinWager();
            slider.max = maxWager;
            slider.value = Math.min(50, maxWager);
            slider.disabled = false;
        }
        updateWagerDisplay();
    }

    function updateWagerDisplay() {
        const amount = parseInt(display.wagerSlider.value, 10);
        display.wagerAmountDisplay.textContent = amount;
        display.wagerPotAmount.textContent = amount * 2;
    }

    function getWagerAmount() {
        return parseInt(display.wagerSlider.value, 10);
    }

    function setWagerRoomCode(code) {
        if (display.wagerRoomCodeDisplay) {
            display.wagerRoomCodeDisplay.textContent = code;
        }
    }

    function showWagerWarning(msg) {
        display.wagerWarning.textContent = msg;
        display.wagerWarning.classList.toggle('hidden', !msg);
    }

    function showAdCooldown(remainingSec) {
        if (remainingSec > 0) {
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            display.wagerAdCooldown.textContent = `Next ad available in ${mins}:${secs.toString().padStart(2, '0')}`;
            display.wagerAdCooldown.classList.remove('hidden');
        } else {
            display.wagerAdCooldown.classList.add('hidden');
        }
    }

    // ===== Lobby =====
    function setRoomCode(code) {
        display.roomCode.textContent = code;
        display.gameRoomCode.textContent = `Room: ${code}`;
    }

    function setPlayerNames(hostName, guestName) {
        display.hostName.textContent = hostName;
        display.guestName.textContent = guestName;
    }

    function setLobbyWager(wagerAmount, potAmount) {
        display.lobbyWagerAmount.textContent = wagerAmount;
        display.lobbyPotAmount.textContent = potAmount;
        display.lobbyWagerInfo.classList.remove('hidden');
    }

    function clearLobbyWager() {
        display.lobbyWagerInfo.classList.add('hidden');
    }

    function showLobbyWaiting(text) {
        const el = document.getElementById('lobby-waiting');
        const txt = document.getElementById('lobby-waiting-text');
        if (txt) txt.textContent = text || 'Waiting for opponent';
        if (el) el.classList.remove('hidden');
    }

    function hideLobbyWaiting() {
        const el = document.getElementById('lobby-waiting');
        if (el) el.classList.add('hidden');
    }

    function showLobbyError(text) {
        const el = document.getElementById('lobby-error');
        const txt = document.getElementById('lobby-error-text');
        if (txt) txt.textContent = text;
        if (el) el.classList.remove('hidden');
    }

    function hideLobbyError() {
        const el = document.getElementById('lobby-error');
        if (el) el.classList.add('hidden');
    }

    // Switch lobby from "pre-join" (waiting for opponent) to "post-join" (opponent connected)
    function setLobbyJoinedState(isJoined) {
        const heading = document.querySelector('#lobby-screen h2');
        const roomCodeDisplay = document.querySelector('#lobby-screen .room-code-display');
        const inviteBtn = document.getElementById('btn-invite');
        if (isJoined) {
            if (heading) heading.classList.add('hidden');
            if (roomCodeDisplay) roomCodeDisplay.classList.add('hidden');
            if (inviteBtn) inviteBtn.classList.add('hidden');
        } else {
            if (heading) heading.classList.remove('hidden');
            if (roomCodeDisplay) roomCodeDisplay.classList.remove('hidden');
            if (inviteBtn) inviteBtn.classList.remove('hidden');
        }
    }

    // ===== Game =====
    function setGameInfo(xName, oName, isMultiplayer) {
        display.playerXName.textContent = xName;
        display.playerOName.textContent = oName;
        display.gameRoomInfo.classList.toggle('hidden', !isMultiplayer);
    }

    function setGameWager(potAmount) {
        display.gamePotAmount.textContent = potAmount;
        display.gameWagerInfo.classList.toggle('hidden', !potAmount);
    }

    function setTurnIndicator(currentPlayer, mySymbol, isMultiplayer) {
        if (isMultiplayer) {
            const isMyTurn = currentPlayer === mySymbol;
            display.turnIndicator.textContent = isMyTurn ? 'Your Turn' : "Opponent's Turn";
        } else {
            display.turnIndicator.textContent = `${currentPlayer}'s Turn`;
        }
        display.turnIndicator.className = `turn-indicator ${currentPlayer.toLowerCase()}-turn`;

        // Active player highlight
        const xTag = display.playerXName;
        const oTag = display.playerOName;
        xTag.classList.remove('active', 'x-active', 'o-active');
        oTag.classList.remove('active', 'x-active', 'o-active');

        if (currentPlayer === 'X') {
            xTag.classList.add('active', 'x-active');
        } else {
            oTag.classList.add('active', 'o-active');
        }

        // Dim board on opponent's turn
        if (isMultiplayer) {
            const isMyTurn = currentPlayer === mySymbol;
            display.board.classList.toggle('dimmed', !isMyTurn);
        } else {
            display.board.classList.remove('dimmed');
        }

        ghostPlayer = currentPlayer;
    }

    function renderBoard(board, winLine) {
        const cells = display.board.querySelectorAll('.cell');
        const winSet = winLine ? new Set(winLine) : null;

        cells.forEach((cell, i) => {
            const mark = board[i];
            cell.textContent = mark || '';
            cell.className = 'cell';
            cell.removeAttribute('data-ghost');

            if (mark) {
                cell.classList.add('taken', mark.toLowerCase());
                if (winSet && winSet.has(i)) {
                    cell.classList.add('win');
                } else if (winLine) {
                    cell.classList.add('loser');
                }
            } else {
                cell.setAttribute('data-ghost', ghostPlayer);
            }
        });
    }

    function clearBoard() {
        const cells = display.board.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.textContent = '';
            cell.className = 'cell';
            cell.removeAttribute('data-ghost');
        });
        display.board.classList.remove('dimmed');
    }

    // ===== Connection =====
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

    // ===== Game Over =====
    function showGameOverForResult(winner, isMultiplayer, mySymbol, coinChange) {
        const emoji = display.resultEmoji;
        const coins = display.resultCoins;

        if (!winner) {
            display.resultText.textContent = "It's a Draw!";
            display.resultSubtext.textContent = 'Your wager has been refunded.';
            emoji.textContent = '🤝';
            coins.textContent = '±0 💰';
            coins.className = 'result-coins draw';
        } else if (isMultiplayer) {
            const iWon = winner === mySymbol;
            display.resultText.textContent = iWon ? 'You Win!' : 'You Lose';
            display.resultSubtext.textContent = iWon ? 'Congratulations! 🎮' : 'Better luck next time!';
            emoji.textContent = iWon ? '🏆' : '💔';
            if (iWon) {
                coins.textContent = `+${coinChange} 💰`;
                coins.className = 'result-coins win';
            } else {
                coins.textContent = `-${Math.abs(coinChange)} 💰`;
                coins.className = 'result-coins lose';
            }
        } else {
            display.resultText.textContent = `Player ${winner} Wins!`;
            display.resultSubtext.textContent = 'Congratulations!';
            emoji.textContent = '🎉';
            coins.textContent = '';
            coins.className = 'result-coins';
        }
        showScreen('gameover');
    }

    // ===== Disconnect Modal =====
    function showDisconnectModal() {
        const modal = document.getElementById('disconnect-modal');
        if (modal) {
            modal.classList.add('active');
            const emoji = modal.querySelector('.modal-emoji');
            if (emoji) emoji.textContent = '😔';
        }
    }
    function hideDisconnectModal() {
        const modal = document.getElementById('disconnect-modal');
        if (modal) modal.classList.remove('active');
    }

    // ===== Event Binding =====
    function onButton(id, callback) {
        buttonCallbacks[id] = callback;
        if (buttons[id]) buttons[id].addEventListener('click', callback);
    }

    function onCellClick(callback) {
        display.board.addEventListener('click', (e) => {
            const cell = e.target.closest('.cell');
            if (cell) callback(parseInt(cell.dataset.index));
        });
    }

    display.roomCodeInput.addEventListener('input', () => {
        display.roomCodeInput.value = display.roomCodeInput.value.toUpperCase();
    });
    display.roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') buttons.joinConfirm.click();
    });

    // Wager slider listener
    if (display.wagerSlider) {
        display.wagerSlider.addEventListener('input', updateWagerDisplay);
    }

    return {
        showScreen, getCurrentScreen,
        showAdOverlay, hideAdOverlay,
        setLoadingText, setUserInfo, setLoadingProgress,
        updateCoinDisplay, pulseCoinHud, showCoinWinAnimation,
        toggleJoinContainer,
        setWagerScreen, setWagerRoomCode, updateWagerDisplay, getWagerAmount, showWagerWarning, showAdCooldown,
        setRoomCode, setPlayerNames, setLobbyWager, clearLobbyWager,
        setGameInfo, setGameWager, setTurnIndicator, renderBoard, clearBoard,
        setConnectionStatus, showGameOverForResult,
        onButton, onCellClick,
        showDisconnectModal, hideDisconnectModal,
        setLobbyJoinedState, showLobbyWaiting, hideLobbyWaiting,
        showLobbyError, hideLobbyError
    };
})();
