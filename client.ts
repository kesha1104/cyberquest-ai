// randomUUID is unavailable on an HTTP development preview in some browsers.
// This is only a correlation ID; anonymous authentication tokens stay server-only.
export function createRequestId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto) {
    if (typeof source.randomUUID === 'function') return source.randomUUID();
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export class GameRequestError extends Error {
    constructor(message: string, public code: string, public status = 0, public requestId = '', public retryAfterMs = 0) { super(message); }
}
// Deadline covers both fetch and body parsing. Even a stalled fetch cannot leave
// a command pending indefinitely. A timed-out start is reconciled by room polling.
export async function requestGame<T>(body: {op: string; [key: string]: unknown}, fetcher: typeof fetch = fetch, timeoutMs = 8000): Promise<T> {
    const controller = new AbortController();
    const requestId = createRequestId();
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
            controller.abort();
            reject(new GameRequestError('Connection timed out. Checking the current room state; you can retry once the connection returns.', 'REQUEST_TIMEOUT', 0, requestId));
        }, timeoutMs);
    });
    try {
        const work = (async () => {
            const response = await fetcher('/api/game', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'X-CyberQuest-Request-Id': requestId }, body: JSON.stringify(body)
            });
            let data: any;
            try { data = await response.json(); }
            catch { throw new GameRequestError('The server returned an unreadable response. Reconnecting…', 'INVALID_RESPONSE', response.status, requestId); }
            if (!response.ok) throw new GameRequestError(data.error || 'Request failed. Please retry.', data.code || 'SERVER_ERROR', response.status, data.requestId || requestId, data.retryAfterMs || 0);
            return data as T;
        })();
        return await Promise.race([work, deadline]);
    } catch (error) {
        const failure = error instanceof GameRequestError ? error : new GameRequestError('Network error. Check your connection; the room will reconnect automatically.', 'NETWORK_ERROR', 0, requestId);
        // Whitelist metadata only: never log cookies, tokens, request bodies or player identifiers.
        console.warn(JSON.stringify({ event: 'client_request_failed', op: body.op, code: failure.code, status: failure.status, requestId: failure.requestId }));
        throw failure;
    } finally { clearTimeout(timeout!); }
}
export function isNewerSnapshot(previous: {code: string; version: number; now: number} | null, next: {code: string; version: number; now: number}) {
    return !previous || previous.code !== next.code || next.version > previous.version || (next.version === previous.version && next.now >= previous.now);
}
