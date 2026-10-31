import { scenarios } from './scenarios';
import { isActive, HOST_GRACE_MS, startReadiness } from './presence';
export type Player = {
    id: string;
    name: string;
    seen: number;
    answers: Record<string, number>;
};
export type Room = {
    code: string;
    host: string;
    players: Player[];
    phase: 'lobby' | 'question' | 'reveal' | 'finished';
    round: number;
    deadline: number;
    match: string;
    order: number[];
};
export function advance(r: Room, now: number, requester?: string) {
    // Renew an authenticated member before checking host expiry, including on refresh.
    const returning = r.players.find(p => p.id === requester);
    if (returning) returning.seen = now;
    while ((r.phase === 'question' || r.phase === 'reveal') && now >= r.deadline) {
    if (r.phase === 'question') {
        r.phase = 'reveal';
        r.deadline += 12000;
    }
    else if (r.round === 4) {
        r.phase = 'finished';
    }
    else {
        r.round++;
        r.phase = 'question';
        r.deadline += 30000;
    }
} const host = r.players.find(p => p.id === r.host); if (!host || now - host.seen > HOST_GRACE_MS) {
    const live = r.players.filter(p => isActive(p, now));
    if (live.length)
        r.host = live[0].id;
} }
export function score(r: Room, p: Player) { return r.order.reduce((sum, q, i) => sum + (p.answers[i] === scenarios[q].correct ? 100 : 0), 0); }
export function project(r: Room, id: string, now: number, version: number) { const p = r.players.find(p => p.id === id)!; const q = scenarios[r.order[r.round]]; const reveal = r.phase === 'reveal' || r.phase === 'finished'; return { code: r.code, phase: r.phase, round: r.round, deadline: r.deadline, match: r.match, now, version, you: id, host: r.host, start: startReadiness(r, id, now), players: r.players.map(x => ({ id: x.id, name: x.name, online: isActive(x, now), lastSeenAt: x.seen, score: r.phase === 'question' ? r.order.reduce((s, q, i) => s + (i < r.round && x.answers[i] === scenarios[q].correct ? 100 : 0), 0) : score(r, x), submitted: x.answers[r.round] !== undefined })), answer: p.answers[r.round] ?? null, incident: r.phase === 'lobby' ? null : { category: q.category, title: q.title, evidence: q.evidence, question: q.question, options: q.options, ...(reveal ? { correct: q.correct, explanation: q.explanation } : {}) } }; }
