/**
 * Room Management Module — pure logic, no WebSocket dependencies.
 * Testable in isolation.
 */

const HOST_RECONNECT_GRACE_MS = 30000;

class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.players = new Map();
        this._now = null; // injectable clock for testing
    }

    now() {
        return this._now || Date.now();
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code;
        do {
            code = '';
            for (let i = 0; i < 6; i++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
        } while (this.rooms.has(code));
        return code;
    }

    createRoom(hostId, hostName) {
        const roomId = this.generateRoomCode();
        this.rooms.set(roomId, {
            hostName: hostName || 'Host',
            hostId,
            guestName: null,
            guestId: null,
            createdAt: this.now(),
            hostDisconnectedAt: null,
            wager: 0,
            wagerHostConfirmed: false,
            wagerGuestConfirmed: false,
            wagerLocked: false
        });
        return roomId;
    }

    isRoomJoinable(room) {
        if (!room.hostId && room.hostDisconnectedAt) {
            return (this.now() - room.hostDisconnectedAt) < HOST_RECONNECT_GRACE_MS;
        }
        return !!room.hostId;
    }

    joinRoom(roomId, guestId, guestName) {
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, reason: 'Room not found' };
        if (!this.isRoomJoinable(room)) return { success: false, reason: 'Room not found' };
        if (room.guestId) return { success: false, reason: 'Room is full' };
        if (room.hostId === guestId) return { success: false, reason: 'Cannot join your own room' };

        room.guestName = guestName || 'Guest';
        room.guestId = guestId;
        if (!room.hostId && room.hostDisconnectedAt) {
            room.hostDisconnectedAt = null;
        }
        return { success: true, room };
    }

    handlePlayerLeave(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.roomId) return null;

        const roomId = player.roomId;
        const room = this.rooms.get(roomId);
        if (!room) return null;

        let opponentId = null;

        if (room.hostId === playerId) {
            opponentId = room.guestId;
            room.hostDisconnectedAt = this.now();
            room.hostId = null;
        } else if (room.guestId === playerId) {
            opponentId = room.hostId;
            room.guestName = null;
            room.guestId = null;
        }

        player.roomId = null;
        return opponentId;
    }

    addPlayer(playerId, playerData) {
        this.players.set(playerId, { roomId: null, name: 'Player', ...playerData });
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
    }

    getPlayer(playerId) {
        return this.players.get(playerId);
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    deleteRoom(roomId) {
        this.rooms.delete(roomId);
    }

    roomCount() {
        return this.rooms.size;
    }

    playerCount() {
        return this.players.size;
    }

    cleanup() {
        const now = this.now();
        for (const [id, room] of this.rooms) {
            if (!room.hostId && room.hostDisconnectedAt &&
                now - room.hostDisconnectedAt > HOST_RECONNECT_GRACE_MS) {
                this.rooms.delete(id);
                continue;
            }
            if (now - room.createdAt > 3600000) {
                this.rooms.delete(id);
            }
        }
    }
}

module.exports = { RoomManager, HOST_RECONNECT_GRACE_MS };
