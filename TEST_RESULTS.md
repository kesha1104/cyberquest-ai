# CyberQuest AI v1 — Test results

Date: October 30, 2026

## Passed

- Public HTTPS deployment succeeded: https://cyberquest-ai-kesha.sunsettune17.chatgpt.site/
- Anonymous HTTP GET returned 200. Independent HTTP sessions created and joined production rooms with no ChatGPT authentication headers or account registration.
- The complete 25-check integration suite also passed against the public production Workers/D1 endpoint. See `tests/live-results.json`.
- Production browser: completed five rounds with an independent HTTP peer, verified shared score updates, refreshed mid-match, reached final leaderboard (400 and 100 points), and restarted in the same room with scores reset to zero. A late fifth answer was correctly rejected by the server.

- Production Vinext/Workers build.
- TypeScript `tsc --noEmit`.
- No incident titles or answer bank found in generated public client assets.
- 25 full-match integration checks in the actual workerd/Miniflare Workers runtime with a real local D1 binding and the authored API handler. Independent clients used separate anonymous cookie jars. Real 30-second questions and 12-second debriefs were used; no timer acceleration or test-only backend endpoints.
- Six additional security/concurrency checks against the current API, including secure cookie flags, malformed JSON objects, cross-origin rejection, oversized requests, concurrent starts, answer bounds, stale match/round rejection, and database-backed rate limiting.
- Browser preview: landing page, room creation, lobby, missing-room error, leave navigation and desktop visual layout.

The full match exercised:

1. Invalid nickname rejection; anonymous room/session creation.
2. One-player start rejection; guest joining; non-host start rejection.
3. Concurrent joining capped at six players; full-room and unauthorized-state errors.
4. Five distinct rounds with identical incidents and server deadlines across clients.
5. Correct answers and explanations absent before reveal.
6. Six simultaneous answer attempts per round: exactly one accepted, the rest rejected.
7. Current-round score withheld until reveal; correct answer +100, wrong answer +0.
8. Late-answer rejection; reconnect preserves identity and locked answer.
9. Shared final leaderboard: 500 and 0 points.
10. Replay preserves room, changes match ID, and clears all scores and answers.
11. Host departure transfers host control.

Machine-readable results: `tests/results.json`, `tests/security-results.json`, and `tests/live-results.json`.

## Verification limits

The cloud browser shares cookies across ordinary tabs. A second tab restored the same player, so the five-round test used independent HTTP session cookie jars in the Workers/D1 harness rather than two isolated browser profiles. This verifies the authored authoritative handler and D1 concurrency behavior, but is not a completed two-device browser end-to-end test.

The managed preview URL was accessible to the cloud browser but not to the executor HTTP client. No additional preview server or network workaround was introduced. The in-process Workers test harness provided independent session coverage instead.

The user subsequently confirmed successful two-device matches (300–0, followed by a 400–400 shared first place). This repair was checked with independent HTTP sessions and browser interaction; a fresh physical phone/laptop retest was not performed here. Actual mobile viewport rendering and large-scale load testing remain unverified. The UI implements responsive breakpoints and network-reconnecting states. Public access and production browser results are recorded above.

## Reproduce

```sh
pnpm install --frozen-lockfile
npm run typecheck
npm test
npm run test:security
npm run build
```

`npm test` takes about 3.5 minutes because it uses real match deadlines. It runs an isolated temporary D1 database. To exercise a reachable live URL with independent HTTP sessions, use `GAME_URL=https://YOUR-GAME-URL node tests/integration.mjs`; this creates test rooms in the live database.

## Launch reliability repair

See BUGFIX_REPORT.md for the reproduced causes, shared presence policy, safe diagnostics and new regression suites. The original user room and its 400–400 final scores were verified unchanged after the repair deployment. `tests/lobby-results.json` records the eight workerd/D1 regression checks. `tests/live-lobby-results.json` records five successful public endpoint checks with real 20-second and >45-second heartbeat gaps.

The repaired public endpoint completed the real-time 25-check five-round suite successfully, including replay and host transfer. 4 timed-out state reads recovered through bounded retries. See `tests/launch-fix-live-match-results.json`. The local controlled-clock full-match suite, eight lobby regressions, six client regressions and six security checks also passed.
