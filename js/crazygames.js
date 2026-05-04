/**
 * CrazyGames SDK wrapper
 * Handles initialization and all SDK module interactions
 */
const CG = (() => {
    let sdk = null;
    let initialized = false;
    let userInfo = null;
    let hasAdblockFlag = false;

    /**
     * Initialize the CrazyGames SDK
     */
    async function init() {
        try {
            if (window.CrazyGames && window.CrazyGames.SDK) {
                sdk = window.CrazyGames.SDK;
                await sdk.init();
                initialized = true;

                // Loading lifecycle
                sdk.game.loadingStart();

                // Check user account
                try {
                    if (sdk.user.isUserAccountAvailable) {
                        userInfo = await sdk.user.getUser();
                    }
                } catch (e) {
                    console.log('CG: User not available:', e);
                }

                // Adblock detection
                try {
                    hasAdblockFlag = await sdk.ad.hasAdblock();
                } catch (e) {
                    console.log('CG: Adblock check failed:', e);
                }

                sdk.game.loadingStop();

                console.log('CG SDK initialized', {
                    user: userInfo ? userInfo.username : 'not logged in',
                    adblock: hasAdblockFlag
                });

                return true;
            }
        } catch (e) {
            console.log('CG SDK init failed (running outside CrazyGames?):', e);
        }

        // Not on CrazyGames — continue without SDK
        initialized = true;
        return true;
    }

    function isReady() { return initialized; }
    function getUser() { return userInfo; }
    function getUsername() { return userInfo ? userInfo.username : null; }
    function hasAdblock() { return hasAdblockFlag; }

    // ===== Game Module =====

    function loadingStart() {
        if (sdk) { try { sdk.game.loadingStart(); } catch(e) {} }
    }

    function loadingStop() {
        if (sdk) { try { sdk.game.loadingStop(); } catch(e) {} }
    }

    function gameplayStart() {
        if (sdk) { try { sdk.game.gameplayStart(); } catch(e) {} }
    }

    function gameplayStop() {
        if (sdk) { try { sdk.game.gameplayStop(); } catch(e) {} }
    }

    function happyTime() {
        if (sdk) { try { sdk.game.happytime(); } catch(e) {} }
    }

    function isInstantMultiplayer() {
        if (sdk) {
            try { return sdk.game.isInstantMultiplayer || false; } catch(e) {}
        }
        return false;
    }

    function updateRoom({ roomId, isJoinable, inviteParams }) {
        if (sdk) {
            try {
                const data = {};
                if (roomId !== undefined) data.roomId = roomId;
                if (isJoinable !== undefined) data.isJoinable = isJoinable;
                if (inviteParams !== undefined) data.inviteParams = inviteParams;
                sdk.game.updateRoom(data);
            } catch(e) {}
        }
    }

    function leftRoom() {
        if (sdk) { try { sdk.game.leftRoom(); } catch(e) {} }
    }

    function addJoinRoomListener(callback) {
        if (sdk) {
            try { sdk.game.addJoinRoomListener(callback); } catch(e) {}
        }
    }

    function removeJoinRoomListener(callback) {
        if (sdk) {
            try { sdk.game.removeJoinRoomListener(callback); } catch(e) {}
        }
    }

    function inviteLink(params) {
        if (sdk) {
            try { return sdk.game.inviteLink(params); } catch(e) {}
        }
        // Fallback: generate a local link
        const url = new URL(window.location.href);
        url.searchParams.set('room', params.roomId || '');
        return url.toString();
    }

    function getInviteParam(key) {
        if (sdk) {
            try { return sdk.game.getInviteParam(key); } catch(e) {}
        }
        // Fallback: parse from URL
        const params = new URLSearchParams(window.location.search);
        return params.get(key);
    }

    function getInviteParams() {
        if (sdk) {
            try { return sdk.game.inviteParams; } catch(e) {}
        }
        // Fallback: parse all from URL
        const params = new URLSearchParams(window.location.search);
        const result = {};
        params.forEach((v, k) => { result[k] = v; });
        return Object.keys(result).length > 0 ? result : null;
    }

    // ===== Ad Module =====

    async function requestAd(type) {
        // type: 'midgame' or 'rewarded'
        return new Promise((resolve) => {
            if (sdk) {
                try {
                    sdk.ad.requestAd(type, {
                        adStarted: () => {
                            console.log(`CG: ${type} ad started`);
                            if (typeof window.onAdStarted === 'function') window.onAdStarted();
                        },
                        adFinished: () => {
                            console.log(`CG: ${type} ad finished`);
                            if (typeof window.onAdFinished === 'function') window.onAdFinished();
                            resolve(true);
                        },
                        adError: (error) => {
                            console.log(`CG: ${type} ad error:`, error);
                            if (typeof window.onAdFinished === 'function') window.onAdFinished();
                            resolve(false);
                        }
                    });
                } catch(e) {
                    console.log('CG: Ad request failed:', e);
                    resolve(false);
                }
            } else {
                // No SDK — simulate ad (dev mode)
                console.log(`CG: Simulating ${type} ad...`);
                setTimeout(() => {
                    if (typeof window.onAdStarted === 'function') window.onAdStarted();
                    setTimeout(() => {
                        if (typeof window.onAdFinished === 'function') window.onAdFinished();
                        resolve(true);
                    }, 500);
                }, 200);
            }
        });
    }

    // ===== Data Module =====

    async function saveData(key, value) {
        if (sdk) {
            try {
                await sdk.data.setItem(key, JSON.stringify(value));
            } catch(e) { console.log('CG saveData error:', e); }
        } else {
            localStorage.setItem(`cg_${key}`, JSON.stringify(value));
        }
    }

    async function loadData(key) {
        if (sdk) {
            try {
                const val = await sdk.data.getItem(key);
                return val ? JSON.parse(val) : null;
            } catch(e) { return null; }
        } else {
            const val = localStorage.getItem(`cg_${key}`);
            return val ? JSON.parse(val) : null;
        }
    }

    return {
        init,
        isReady,
        getUser,
        getUsername,
        hasAdblock,
        loadingStart,
        loadingStop,
        gameplayStart,
        gameplayStop,
        happyTime,
        isInstantMultiplayer,
        updateRoom,
        leftRoom,
        addJoinRoomListener,
        removeJoinRoomListener,
        inviteLink,
        getInviteParam,
        getInviteParams,
        requestAd,
        saveData,
        loadData
    };
})();
