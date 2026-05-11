const { RoomManager } = require('../roomManager');

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
        expect(room.wager).toBe(0);
        expect(room.wagerLocked).toBe(false);
        expect(room.hostBid).toBeUndefined();
        expect(room.guestBid).toBeUndefined();
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

    test('join fails after room is destroyed', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;
        rm.handlePlayerLeave('host1');
        // Room is destroyed, guest cannot join
        const result = rm.joinRoom(id, 'guest1', 'Bob');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Room not found');
    });
});

// ===== handlePlayerLeave — room destroyed immediately =====

describe('handlePlayerLeave', () => {
    test('guest leaves — room is destroyed, host notified', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id;
        rm.getPlayer('guest1').roomId = id;

        const opponentId = rm.handlePlayerLeave('guest1');
        expect(opponentId).toBe('host1');
        // Room is destroyed entirely
        expect(rm.getRoom(id)).toBeUndefined();
        expect(rm.roomCount()).toBe(0);
    });

    test('host leaves — room is destroyed, guest notified', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id;
        rm.getPlayer('guest1').roomId = id;

        const opponentId = rm.handlePlayerLeave('host1');
        expect(opponentId).toBe('guest1');
        // Room is destroyed entirely
        expect(rm.getRoom(id)).toBeUndefined();
        expect(rm.roomCount()).toBe(0);
    });

    test('leave returns null for player not in a room', () => {
        rm.addPlayer('loner', {});
        expect(rm.handlePlayerLeave('loner')).toBeNull();
    });

    test('leave returns null for unknown player', () => {
        expect(rm.handlePlayerLeave('nonexistent')).toBeNull();
    });

    test('double leave does not crash', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id;
        rm.getPlayer('guest1').roomId = id;

        rm.handlePlayerLeave('guest1');
        // Room already destroyed, second leave returns null
        expect(rm.handlePlayerLeave('host1')).toBeNull();
    });

    test('player roomId is cleared after leave', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        rm.handlePlayerLeave('host1');
        expect(rm.getPlayer('host1').roomId).toBeNull();
    });
});

// ===== isRoomJoinable =====

describe('isRoomJoinable', () => {
    test('room with host and no guest is joinable', () => {
        const id = rm.createRoom('host1', 'Alice');
        expect(rm.isRoomJoinable(rm.getRoom(id))).toBe(true);
    });

    test('room with guest is not joinable', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.joinRoom(id, 'guest1', 'Bob');
        expect(rm.isRoomJoinable(rm.getRoom(id))).toBe(false);
    });

    test('room without host is not joinable', () => {
        const id = rm.createRoom('host1', 'Alice');
        const room = rm.getRoom(id);
        room.hostId = null;
        expect(rm.isRoomJoinable(room)).toBe(false);
    });
});

// ===== Cleanup =====

describe('cleanup', () => {
    test('cleanup removes rooms older than 1 hour', () => {
        rm.createRoom('host1', 'Alice');
        expect(rm.roomCount()).toBe(1);

        rm._now = now + 3600001;
        rm.cleanup();

        expect(rm.roomCount()).toBe(0);
    });

    test('cleanup keeps rooms newer than 1 hour', () => {
        rm.createRoom('host1', 'Alice');

        rm._now = now + 3599999;
        rm.cleanup();

        expect(rm.roomCount()).toBe(1);
    });
});

// ===== Leave and recreate flow =====

describe('leave and recreate', () => {
    test('after host leaves, they can create a new room', () => {
        const id1 = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id1;

        // Host leaves — room destroyed
        rm.handlePlayerLeave('host1');
        expect(rm.roomCount()).toBe(0);

        // Host creates a new room
        const id2 = rm.createRoom('host1', 'Alice');
        expect(id2).not.toBe(id1);
        expect(rm.roomCount()).toBe(1);
        expect(rm.getRoom(id2).hostId).toBe('host1');
    });

    test('after guest leaves, both can create new rooms', () => {
        const id1 = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.addPlayer('guest1', {});
        rm.joinRoom(id1, 'guest1', 'Bob');
        rm.getPlayer('host1').roomId = id1;
        rm.getPlayer('guest1').roomId = id1;

        // Guest leaves — room destroyed
        rm.handlePlayerLeave('guest1');
        expect(rm.roomCount()).toBe(0);

        // Both can create new rooms
        const id2 = rm.createRoom('host1', 'Alice');
        const id3 = rm.createRoom('guest1', 'Bob');
        expect(rm.roomCount()).toBe(2);
        expect(id2).not.toBe(id3);
    });
});

// ===== Edge cases =====

describe('edge cases', () => {
    test('leave from empty room (no guest) destroys it', () => {
        const id = rm.createRoom('host1', 'Alice');
        rm.addPlayer('host1', {});
        rm.getPlayer('host1').roomId = id;

        const opponentId = rm.handlePlayerLeave('host1');
        expect(opponentId).toBeNull(); // no guest to notify
        expect(rm.getRoom(id)).toBeUndefined();
    });

    test('room with no host and no guest is not joinable', () => {
        rm.rooms.set('BADRM1', {
            hostName: 'Ghost',
            hostId: null,
            guestId: null,
            guestName: null,
            createdAt: now,
            wager: 0,
            wagerLocked: false
        });

        const result = rm.joinRoom('BADRM1', 'guest1', 'Bob');
        expect(result.success).toBe(false);
    });
});
