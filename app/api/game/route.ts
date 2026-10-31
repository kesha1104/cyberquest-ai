import { env } from 'cloudflare:workers';
import { advance, project, type Room } from '../../../lib/game';
import { isActive, startReadiness } from '../../../lib/presence';
export const dynamic = 'force-dynamic';
class Failure extends Error {
    constructor(public status: number, message: string, public code = 'INVALID_REQUEST', public details: Record<string, unknown> = {}) { super(message); }
}
async function hash(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, '0')).join(''); }
const json = (data: unknown, status = 200, cookie?: string) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
export async function POST(req: Request) {
    const receivedAt = Date.now();
    const suppliedId = req.headers.get('X-CyberQuest-Request-Id') || '';
    const requestId = /^[a-f0-9-]{36}$/i.test(suppliedId) ? suppliedId : crypto.randomUUID();
    let diagnostic: Record<string, unknown> = { requestId, op: 'unknown' };
    const log = (event: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ event, ...diagnostic, ...extra, elapsedMs: Date.now() - receivedAt }));
    try {
        const db = env.DB;
        if (!db)
            throw new Failure(503, 'Game database is unavailable. Please try again shortly.', 'DATABASE_UNAVAILABLE');
        const origin = req.headers.get('origin');
        if (origin && origin !== new URL(req.url).origin)
            throw new Failure(403, 'Cross-site requests are not allowed.');
        if (Number(req.headers.get('content-length') || 0) > 2048)
            throw new Failure(413, 'Request too large.');
        const raw = await req.text();
        if (raw.length > 2048)
            throw new Failure(413, 'Request too large.');
        const b = JSON.parse(raw);
        if (!b || typeof b !== 'object' || Array.isArray(b))
            throw new Failure(400, 'Invalid request.');
        const op = b.op;
        if (typeof op === 'string' && ['create', 'join', 'state', 'start', 'answer', 'leave'].includes(op)) diagnostic.op = op;
        if (!['create', 'join', 'state', 'start', 'answer', 'leave'].includes(op))
            throw new Failure(400, 'Unknown action.');
        const now = Date.now();
        const ip = req.headers.get('cf-connecting-ip') || 'local';
        const key = await hash(ip + ':' + Math.floor(now / 60000) + ':' + (op === 'state' ? 'read' : 'write'));
        const rate = await db.prepare('INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, now + 120000).first<{
            count: number;
        }>();
        if (rate!.count > (op === 'state' ? 600 : 90))
            throw new Failure(429, 'Too many requests. Please wait a minute before retrying.', 'RATE_LIMITED', { retryAfterMs: 60000 - now % 60000 });
        let token = req.headers.get('cookie')?.match(/(?:^|;\s*)cq_session=([a-f0-9]{64})(?:;|$)/)?.[1];
        diagnostic.sessionPresent = Boolean(token);
        if (!token && !['create', 'join'].includes(op)) throw new Failure(401, 'Your game session is missing or expired. Join the room again in this browser.', 'SESSION_REQUIRED');
        let cookie: string | undefined;
        if (!token) {
            token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
            cookie = `cq_session=${token}; HttpOnly; ${new URL(req.url).protocol === 'https:' ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=86400`;
        }
        const id = await hash(token);
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (['join', 'create'].includes(op) && (!/^[\p{L}\p{N} _.-]{2,20}$/u.test(name)))
            throw new Failure(400, 'Use a nickname of 2–20 letters, numbers, spaces, dots, dashes or underscores.');
        if (op === 'create') {
            await db.batch([db.prepare('DELETE FROM rooms WHERE expires<?').bind(now), db.prepare('DELETE FROM limits WHERE expires<?').bind(now)]);
            for (let n = 0; n < 5; n++) {
                const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                const a = crypto.getRandomValues(new Uint8Array(6));
                const code = Array.from(a, x => alphabet[x % alphabet.length]).join('');
                const r: Room = { code, host: id, players: [{ id, name, seen: now, answers: {} }], phase: 'lobby', round: 0, deadline: 0, match: '', order: [] };
                const res = await db.prepare('INSERT OR IGNORE INTO rooms(code,version,data,expires) VALUES (?,0,?,?)').bind(code, JSON.stringify(r), now + 86400000).run();
                if (res.meta.changes)
                    return json(project(r, id, now, 0), 200, cookie);
            }
            throw new Failure(503, 'Could not allocate room. Please retry.');
        }
        const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
        diagnostic.room = code.length === 6 ? code : undefined;
        if (!/^[A-Z2-9]{6}$/.test(code))
            throw new Failure(400, 'Enter the six-character room code.');
        for (let attempt = 0; attempt < 16; attempt++) {
            const row = await db.prepare('SELECT version,data FROM rooms WHERE code=? AND expires>?').bind(code, Date.now()).first<{
                version: number;
                data: string;
            }>();
            if (!row)
                throw new Failure(404, 'Room not found or expired. Check the code or create a new room.', 'ROOM_NOT_FOUND');
            const r: Room = JSON.parse(row.data);
            const clock = Date.now();
            const previousHost = r.host;
            advance(r, clock, id);
            diagnostic = { ...diagnostic, phase: r.phase, version: row.version, attempt, isHost: r.host === id, activePlayers: r.players.filter(x => isActive(x, clock)).length, heartbeatAgesMs: r.players.map(x => Math.max(0, clock - x.seen)) };
            if (previousHost !== r.host) log('host_changed');
            let p = r.players.find(p => p.id === id);
            if (op === 'join' && !p) {
                if (r.phase !== 'lobby' && r.phase !== 'finished')
                    throw new Failure(409, 'Match in progress. Join after the final leaderboard.');
                if (r.players.length >= 6)
                    throw new Failure(409, 'Room full. This room already has six players.');
                if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
                    throw new Failure(409, 'That nickname is already in use. Choose another.');
                p = { id, name, seen: clock, answers: {} };
                r.players.push(p);
            }
            if (!p)
                throw new Failure(403, 'Join this room to continue.', 'MEMBERSHIP_REQUIRED');
            p.seen = clock;
            if (op === 'start') {
                const readiness = startReadiness(r, id, clock);
                log('start_attempt', { reason: readiness.code });
                if (!readiness.canStart) throw new Failure(readiness.code === 'NOT_HOST' ? 403 : 409, readiness.reason, readiness.code, { start: readiness });
                // A delayed retry from a previous match must never start a later replay.
                if (typeof b.expectedMatch === 'string' && b.expectedMatch !== r.match)
                    throw new Failure(409, 'The room changed since your last update. Synchronizing the latest match before you try again.', 'STALE_STATE');
                r.players = r.players.filter(p => isActive(p, clock));
                for (const x of r.players)
                    x.answers = {};
                const pool = Array.from({ length: 14 }, (_, i) => i);
                for (let i = 13; i > 0; i--) {
                    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
                    [pool[i], pool[j]] = [pool[j], pool[i]];
                }
                r.order = pool.slice(0, 5);
                r.round = 0;
                r.phase = 'question';
                r.deadline = clock + 30000;
                r.match = crypto.randomUUID();
            }
            if (op === 'answer') {
                if (r.phase !== 'question' || clock >= r.deadline || b.match !== r.match || b.round !== r.round)
                    throw new Failure(409, 'This round has ended. Wait for the current room state.');
                if (!Number.isInteger(b.answer) || b.answer < 0 || b.answer > 3)
                    throw new Failure(400, 'Select one of the four answers.');
                if (p.answers[r.round] !== undefined)
                    throw new Failure(409, 'Your answer is already locked.');
                p.answers[r.round] = b.answer;
            }
            if (op === 'leave') {
                r.players = r.players.filter(x => x.id !== id);
                advance(r, clock);
            }
            const result = await db.prepare('UPDATE rooms SET data=?,version=version+1 WHERE code=? AND version=?').bind(JSON.stringify(r), code, row.version).run();
            if (result.meta.changes) {
                if (op === 'start') log('start_success', { version: row.version + 1, activePlayers: r.players.length });
                return json(op === 'leave' ? { left: true, requestId } : { ...project(r, id, clock, row.version + 1), requestId }, 200, cookie);
            }
            if (op === 'start') log('start_retry', { reason: 'VERSION_CONFLICT' });
        }
        throw new Failure(409, 'Room state changed repeatedly. Synchronizing; please retry.', 'STATE_CONFLICT');
    }
    catch (e) {
        if (e instanceof Failure) {
            log(diagnostic.op === 'start' ? 'start_denied' : 'request_denied', { status: e.status, reason: e.code });
            return json({ error: e.message, code: e.code, requestId, ...e.details }, e.status);
        }
        if (e instanceof SyntaxError)
            return json({ error: 'Invalid request.', code: 'INVALID_REQUEST', requestId }, 400);
        console.error(JSON.stringify({ event: 'server_error', ...diagnostic, status: 500, errorType: e instanceof Error ? e.name : 'unknown' }));
        return json({ error: 'The server could not complete this request. Reconnecting; please retry.', code: 'SERVER_ERROR', requestId }, 500);
    }
}
