// One presence policy shared by the authoritative server and the lobby display.
// A short missed poll is not a departure. Explicit leave always removes the seat.
export const PRESENCE_WINDOW_MS = 45_000;
export const FRESH_HEARTBEAT_MS = 15_000;
export const HOST_GRACE_MS = 90_000;
export type PresencePlayer = { id: string; name: string; seen: number };
export function isActive(player: { seen: number }, now: number) {
    return now - player.seen < PRESENCE_WINDOW_MS;
}
export function presenceLabel(seen: number, now: number) {
    const age = Math.max(0, now - seen);
    return age < FRESH_HEARTBEAT_MS ? 'Connected' : age < PRESENCE_WINDOW_MS
        ? 'Reconnecting · recently active' : 'Offline · return to the game';
}
export function startReadiness(room: { host: string; phase: string; players: PresencePlayer[] }, requester: string, now: number) {
    const activePlayers = room.players.filter(p => isActive(p, now)).length;
    const hostName = room.players.find(p => p.id === room.host)?.name || 'another analyst';
    if (room.host !== requester) return { canStart: false, code: 'NOT_HOST', reason: `Only the current host (${hostName}) can start this room.`, activePlayers };
    if (!['lobby', 'finished'].includes(room.phase)) return { canStart: false, code: 'MATCH_RUNNING', reason: 'A match is already running. Synchronizing the current round…', activePlayers };
    if (activePlayers < 2) return { canStart: false, code: 'INSUFFICIENT_PLAYERS', reason: `Only ${activePlayers} of 2 required players are recently connected. Ask the other player to return to the game; we will recheck automatically.`, activePlayers };
    return { canStart: true, code: 'READY', reason: `${activePlayers} players recently connected. Ready to launch.`, activePlayers };
}
