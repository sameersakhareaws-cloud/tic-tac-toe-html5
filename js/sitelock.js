/**
 * Sitelock module — restricts game to authorized CrazyGames domains
 * Whitelists all known CrazyGames domains
 */
const Sitelock = (() => {
    const ALLOWED_DOMAINS = [
        'crazygames.com',
        'www.crazygames.com',
        'sandbox.crazygames.com',
        'api.crazygames.com',
        'sdk.crazygames.com',
        'player.crazygames.com',
        'preview.crazygames.com',
        'localhost',            // Dev
        '127.0.0.1',           // Dev
    ];

    function isAllowedDomain() {
        const hostname = window.location.hostname;
        // Always allow localhost for development
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') return true;
        return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    }

    function enforce() {
        if (!isAllowedDomain()) {
            console.log('Sitelock: Unauthorized domain — redirecting');
            window.location.href = 'https://www.crazygames.com/';
            return false;
        }
        return true;
    }

    return { isAllowedDomain, enforce };
})();
