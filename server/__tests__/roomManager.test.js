const { RoomManager, HOST_RECONNECT_GRACE_MS } = require('../roomManager');

let rm;
let now;

beforeEach(() => {
    now = 1000000;
    rm = new RoomManager();
    rm._now = now;
});

// ===== createRoom =====

describe('createRoom', () => {
    test('creates a room with a 6-char code', () => {
        const id = rm.createRoom('host1', 'Alice');
        expect(id).toHaveLength(6);
        expect(id).toMatch(/^[A-Z0-9]+$/);
    });

    test('room has correct initial state', () => {
        const id = rm.createRoom('host1', 'Alice');
        const room = rm.getRoom(id);
        expect(room.hostName).toBe('Alice');
        expect(room.hostId).toBe('host1');
        expect(room.guestId).toBeNull();
        expect(room.guestName).toBeNull();
        expect(room.createdAt).toBe(now);
        expect(room.hostDisconnectedAt).toBeNull();
    });

    test('generates unique codes', () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++) {
            ids.add(rm.createRoom('host' + i, 'Player' + i));
        }
        expect(ids.size).toBe(100);
    });
});

// ===== joinRoom =====

describe('joinRoom', () => {
    test('guest can join an existing room', () => {
        const id = rm.createRoom('host1', 'Alice');
        const result = rm.joinRoom(id, 'guest1', 'Bob');
        expect(result.success).toBe(true);
        expect(result.room.guestId).toBe('guest1');
        expect(result.room.guestName).toBe('Bob');
    });

    test('join fails for non-existent room', () => {
        const result = rm.joinRoom('XXXXXX', 'guest1', 'Bob');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Room not found');
    });

    test('join fails when room is full', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.joinRoom(id, 'guest1', 'Bob');
        const result = rm.joinRoom(id, 'guest2', 'Charlie');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Room is full');
    });

    test('host cannot join their own room', () => {
        const id = rm.createRoom('host1', 'Alice');
        const result = rm.joinRoom(id, 'host1', 'Alice');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Cannot join your own room');
    });
});

// ===== handlePlayerLeave =====

describe('handlePlayerLeave', () => {
    test('guest leaves — room stays, host notified', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id;
        rm.getPlayer('guest1').roomId = id;

        const opponentId = rm.handlePlayerLeave('guest1');
        expect(opponentId).toBe('host1');
        expect(rm.getRoom(id)).toBeDefined();
        expect(rm.getRoom(id).guestId).toBeNull();
        expect(rm.getRoom(id).hostId).toBe('host1');
    });

    test('host leaves — room enters grace period', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id;
        rm.getPlayer('guest1').roomId = id;

        const opponentId = rm.handlePlayerLeave('host1');
        expect(opponentId).toBe('guest1');
        const room = rm.getRoom(id);
        expect(room).toBeDefined();
        expect(room.hostId).toBeNull();
        expect(room.hostDisconnectedAt).toBe(now);
        expect(room.guestId).toBe('guest1'); // guest still in room
    });

    test('leave returns null for player not in a room', () => {
        rm.addPlayer('loner', {});
        expect(rm.handlePlayerLeave('loner')).toBeNull();
    });

    test('leave returns null for unknown player', () => {
        expect(rm.handlePlayerLeave('nonexistent')).toBeNull();
    });
});

// ===== Grace period =====

describe('grace period', () => {
    test('room is joinable during grace period', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.getPlayer('host1').roomId = id;

        // Host disconnects
        rm.handlePlayerLeave('host1');

        // Guest can still join during grace period
        const result = rm.joinRoom(id, 'guest1', 'Bob');
        expect(result.success).toBe(true);
    });

    test('room is NOT joinable after grace period expires', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        // Host disconnects
        rm.handlePlayerLeave('host1');

        // Advance time past grace period
        rm._now = now + HOST_RECONNECT_GRACE_MS + 1;

        const result = rm.joinRoom(id, 'guest1', 'Bob');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Room not found');
    });

    test('cleanup removes rooms past grace period', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        rm.handlePlayerLeave('host1');
        expect(rm.roomCount()).toBe(1);

        // Advance past grace period
        rm._now = now + HOST_RECONNECT_GRACE_MS + 1;
        rm.cleanup();

        expect(rm.roomCount()).toBe(0);
    });

    test('cleanup keeps rooms within grace period', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        rm.handlePlayerLeave('host1');

        // Advance but not past grace period
        rm._now = now + HOST_RECONNECT_GRACE_MS - 1000;
        rm.cleanup();

        expect(rm.roomCount()).toBe(1);
    });

    test('cleanup removes rooms older than 1 hour', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        // Advance past 1 hour
        rm._now = now + 3600001;
        rm.cleanup();

        expect(rm.roomCount()).toBe(0);
    });
});

// ===== Host reconnection =====

describe('host reconnection', () => {
    test('guest joins during grace period, host reconnects and room is restored', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.getPlayer('host1').roomId = id;

        // Host disconnects
        rm.handlePlayerLeave('host1');

        // Guest joins during grace period
        const joinResult = rm.joinRoom(id, 'guest1', 'Bob');
        expect(joinResult.success).toBe(true);

        // Grace period disconnect marker should be cleared
        expect(rm.getRoom(id).hostDisconnectedAt).toBeNull();
    });

    test('guest in room during grace period is preserved after host reconnects', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.addPlayer('guest2', {});
        rm.getPlayer('host1').roomId = id;

        // Guest1 joins
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('guest1').roomId = id;

        // Host disconnects
        rm.handlePlayerLeave('host1');

        // Guest2 tries to join — room is full (guest1 is there)
        const result = rm.joinRoom(id, 'guest2', 'Charlie');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Room is full');
    });
});

// ===== Edge cases =====

describe('edge cases', () => {
    test('double host leave does not crash', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        rm.handlePlayerLeave('host1');
        expect(rm.handlePlayerLeave('host1')).toBeNull();
    });

    test('double guest leave does not crash', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.getPlayer('host1').roomId = id;
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('guest1').roomId = id;

        rm.handlePlayerLeave('guest1');
        expect(rm.handlePlayerLeave('guest1')).toBeNull();
    });

    test('room with no host and no disconnect timestamp is not joinable', () => {
        // Manually create a corrupted room state
        rm.rooms.set('BADRM1', {
            hostName: 'Ghost',
            hostId: null,
            guestId: null,
            guestName: null,
            createdAt: now,
            hostDisconnectedAt: null
        });

        const result = rm.joinRoom('BADRM1', 'guest1', 'Bob');
        expect(result.success).toBe(false);
    });
});
