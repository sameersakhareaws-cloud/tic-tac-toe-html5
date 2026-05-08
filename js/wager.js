/**
 * Wager & Coin Management Module
 * 
 * Features:
 * - Coin balance stored via CrazyGames data module (cloud-synced)
 * - New users start with 500 coins
 * - Earn 100 coins per rewarded ad (5 min cooldown)
 * - Wager system for multiplayer games
 * - Slider with step of 25, minimum 10 coins
 * - Coin animation on wins
 */
const Wager = (() => {
    const STARTING_BALANCE = 500;
    const COINS_PER_AD = 100;
    const AD_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const MIN_WAGER = 10;
    const WAGER_STEP = 25;

    let balance = 0;
    let lastAdTime = 0;
    let totalWon = 0;
    let totalLost = 0;
    let gamesPlayed = 0;
    let balanceLoaded = false;

    // ===== Coin Balance =====

    async function init() {
        try {
            const saved = await CG.loadData('tt_coins');
            if (saved !== null && saved !== undefined) {
                balance = parseInt(saved, 10) || 0;
            } else {
                balance = STARTING_BALANCE;
                await saveBalance();
            }

            const adTime = await CG.loadData('tt_last_ad');
            lastAdTime = adTime ? parseInt(adTime, 10) : 0;

            const stats = await CG.loadData('tt_stats');
            if (stats) {
                totalWon = stats.won || 0;
                totalLost = stats.lost || 0;
                gamesPlayed = stats.games || 0;
            }
        } catch (e) {
            console.log('Wager init error:', e);
            balance = STARTING_BALANCE;
        }
        balanceLoaded = true;
    }

    async function saveBalance() {
        try {
            await CG.saveData('tt_coins', balance);
        } catch (e) { console.log('Save balance error:', e); }
    }

    async function saveStats() {
        try {
            await CG.saveData('tt_stats', { won: totalWon, lost: totalLost, games: gamesPlayed });
        } catch (e) { console.log('Save stats error:', e); }
    }

    function getBalance() { return balance; }
    function getStats() { return { won: totalWon, lost: totalLost, games: gamesPlayed }; }
    function isLoaded() { return balanceLoaded; }

    // ===== Ad Coins =====

    function canWatchAd() {
        return Date.now() - lastAdTime >= AD_COOLDOWN_MS;
    }

    function getAdCooldownRemaining() {
        const remaining = AD_COOLDOWN_MS - (Date.now() - lastAdTime);
        return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    }

    async function earnCoinsFromAd() {
        if (!canWatchAd()) return { success: false, reason: 'cooldown', remaining: getAdCooldownRemaining() };

        // Show rewarded ad
        const adResult = await CG.requestAd('rewarded');
        if (!adResult) return { success: false, reason: 'ad_failed' };

        balance += COINS_PER_AD;
        lastAdTime = Date.now();
        await saveBalance();
        try { await CG.saveData('tt_last_ad', lastAdTime); } catch (e) {}

        return { success: true, earned: COINS_PER_AD, newBalance: balance };
    }

    // ===== Wager Logic =====

    function getMinWager() { return MIN_WAGER; }
    function getWagerStep() { return WAGER_STEP; }

    function getMaxWager(playerBalance) {
        // Max wager is the player's full balance, rounded down to step
        return Math.floor((playerBalance || balance) / WAGER_STEP) * WAGER_STEP;
    }

    function isValidWager(amount, playerBalance) {
        const bal = playerBalance || balance;
        return amount >= MIN_WAGER && amount <= bal && amount % WAGER_STEP === 0;
    }

    async function deductWager(amount) {
        if (balance < amount) return false;
        balance -= amount;
        gamesPlayed++;
        await saveBalance();
        await saveStats();
        return true;
    }

    async function addWinnings(amount) {
        balance += amount;
        totalWon += amount;
        await saveBalance();
        await saveStats();
    }

    async function recordLoss(amount) {
        totalLost += amount;
        await saveStats();
    }

    async function refundWager(amount) {
        balance += amount;
        await saveBalance();
    }

    // ===== Formatting =====

    function formatCoins(amount) {
        if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'M';
        if (amount >= 1000) return (amount / 1000).toFixed(1) + 'K';
        return amount.toString();
    }

    return {
        init, saveBalance,
        getBalance, getStats, isLoaded,
        canWatchAd, getAdCooldownRemaining, earnCoinsFromAd,
        getMinWager, getWagerStep, getMaxWager, isValidWager,
        deductWager, addWinnings, recordLoss, refundWager,
        formatCoins,
        STARTING_BALANCE, COINS_PER_AD, AD_COOLDOWN_MS, MIN_WAGER, WAGER_STEP
    };
})();
