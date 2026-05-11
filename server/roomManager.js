/**
 * Room Management Module — pure logic, no WebSocket dependencies.
 * Testable in isolation.
 */

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
            hostBid: undefined,
            guestBid: undefined,
            wager: 0,
            wagerLocked: false
        });
        return roomId;
    }

    isRoomJoinable(room) {
        return !!room.hostId && !room.guestId;
    }

    joinRoom(roomId, guestId, guestName) {
        const room = this.rooms.get(roomId);
        if (!room || !room.hostId) return { success: false, reason: 'Room not found' };
        if (room.guestId) return { success: false, reason: 'Room is full' };
        if (room.hostId === guestId) return { success: false, reason: 'Cannot join your own room' };

        room.guestName = guestName || 'Guest';
        room.guestId = guestId;
        return { success: true, room };
    }

    handlePlayerLeave(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.roomId) return null;

        const roomId = player.roomId;
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const opponentId = (room.hostId === playerId) ? room.guestId : room.hostId;
        this.rooms.delete(roomId);
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
            if (now - room.createdAt > 3600000) {
                this.rooms.delete(id);
            }
        }
    }
}

module.exports = { RoomManager };
