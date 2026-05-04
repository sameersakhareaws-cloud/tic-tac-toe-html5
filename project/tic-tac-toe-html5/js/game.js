/**
 * Tic-Tac-Toe game logic
 * Pure game state — no DOM, no network
 */
const TicTacToe = (() => {
    // Winning combinations
    const WIN_PATTERNS = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],  // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8],  // columns
        [0, 4, 8], [2, 4, 6]               // diagonals
    ];

    let board = Array(9).fill(null);
    let currentPlayer = 'X';
    let gameOver = false;
    let winner = null;
    let winLine = null;
    let moveHistory = [];

    function getBoard() { return [...board]; }
    function getCurrentPlayer() { return currentPlayer; }
    function isGameOver() { return gameOver; }
    function getWinner() { return winner; }
    function getWinLine() { return winLine; }
    function getMoveHistory() { return [...moveHistory]; }

    /**
     * Make a move. Returns { success, win, winLine, winner, draw }
     */
    function makeMove(cellIndex, player) {
        if (gameOver) return { success: false, reason: 'Game is over' };
        if (player !== currentPlayer) return { success: false, reason: 'Not your turn' };
        if (cellIndex < 0 || cellIndex > 8) return { success: false, reason: 'Invalid cell' };
        if (board[cellIndex] !== null) return { success: false, reason: 'Cell taken' };

        board[cellIndex] = player;
        moveHistory.push({ cell: cellIndex, player });

        // Check win
        const winResult = checkWin(player);
        if (winResult) {
            gameOver = true;
            winner = player;
            winLine = winResult;
            return { success: true, win: true, winLine: winResult, winner: player };
        }

        // Check draw
        if (board.every(cell => cell !== null)) {
            gameOver = true;
            return { success: true, draw: true };
        }

        // Switch turn
        currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
        return { success: true };
    }

    /**
     * Apply a move without validation (for network sync)
     */
    function applyRemoteMove(cellIndex, player) {
        if (board[cellIndex] !== null) return false;
        board[cellIndex] = player;
        moveHistory.push({ cell: cellIndex, player });

        const winResult = checkWin(player);
        if (winResult) {
            gameOver = true;
            winner = player;
            winLine = winResult;
            return { win: true, winLine: winResult, winner: player };
        }

        if (board.every(cell => cell !== null)) {
            gameOver = true;
            return { draw: true };
        }

        currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
        return { switched: true };
    }

    function checkWin(player) {
        for (const pattern of WIN_PATTERNS) {
            if (pattern.every(idx => board[idx] === player)) {
                return pattern;
            }
        }
        return null;
    }

    function reset() {
        board = Array(9).fill(null);
        currentPlayer = 'X';
        gameOver = false;
        winner = null;
        winLine = null;
        moveHistory = [];
    }

    return {
        getBoard,
        getCurrentPlayer,
        isGameOver,
        getWinner,
        getWinLine,
        getMoveHistory,
        makeMove,
        applyRemoteMove,
        reset,
        WIN_PATTERNS
    };
})();
