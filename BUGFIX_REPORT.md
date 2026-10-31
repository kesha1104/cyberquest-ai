# Intermittent Launch Challenge — investigation and repair

October 30, 2026. Existing Site and URL preserved. No database schema change, room reset or scenario modification.

## Reproduced causes

The original UI disabled launch when `busy` was true or the last snapshot contained fewer than two `online` players. The 2/6 roster count represented occupied seats, not active heartbeats. The browser did not age the last received connected label.

1. Original server presence expired at 15 seconds. In an isolated workerd/D1 test, a snapshot showed two connected players, then a 16-second guest heartbeat gap caused the server to reject launch with 409. Normal mobile background throttling or a short polling interruption can therefore disagree with an older connected label. The existing production room inspection also showed a guest heartbeat gap longer than 15 seconds.
2. Host expiry/transfer was evaluated before updating the requesting member's heartbeat. A returning host with a 46-second old heartbeat was rejected with 403 even though that host had just sent an authenticated start request. This was reproduced against the original deployed source in workerd/D1.
3. Fetch and JSON parsing had no deadline. A stalled command could retain `busy=true`, or a stalled state read could retain the polling loop's `running=true`. Bounded-request tests now cover both fetch and body stalls. Historical logs do not prove that a specific reported click stalled.

The available historical Worker logs contain no per-action reason codes, so they cannot identify which mechanism caused each of the user's earlier failures. Recent API requests in the inspected log sample were HTTP 200, without a corresponding API crash. No evidence established token corruption or D1 data loss.

## Fix

- One shared presence policy: 15-second fresh label, 45-second recently-active eligibility, 90-second host absence grace. Two distinct recently active members are still required; host-only authorization is unchanged.
- Renew a known authenticated member before evaluating host expiry. A host already replaced by another member cannot reclaim ownership by returning.
- Presence labels age locally even without a new snapshot. Start/replay display explicit readiness/reconnection explanations and a Recheck room action.
- Remove the stale client roster-count gate: the host can always ask the server to validate start eligibility. Buttons disable only during a bounded command. The server remains the final authority and returns actionable insufficient-player, non-host, stale-state, conflict, missing-session and server-error responses.
- Eight-second request deadlines cover network and JSON parsing. Polling retries with bounded backoff, preserves membership on network/5xx failures, and resyncs on focus, visibility and network restoration. Initial restore uses the same polling path instead of overlapping it.
- Ignore older snapshot versions/timestamps and results from earlier room generations. Include the expected match ID in start requests to prevent a delayed retry from starting a later replay.
- Structured safe diagnostics: request ID, operation, room code, phase/version, attempt number, host authorization boolean, active count, heartbeat ages, reason code and elapsed time. No raw session tokens, cookie headers, player digests or names are logged by the application.

## Changed files

- `app/page.tsx`: bounded command handling, single restore/polling path, reconnection, version/generation guards, presence/readiness explanations, launch/replay controls.
- `app/api/game/route.ts`: requester-aware heartbeat ordering, authoritative readiness, expected-match guard, structured errors and diagnostic logs.
- `lib/game.ts`: shared presence checks and public last-seen/readiness data.
- `lib/presence.ts`: shared presence and readiness rules.
- `lib/client.ts`: bounded requests, safe client diagnostics, snapshot ordering, HTTP-preview-compatible correlation IDs.
- `app/globals.css`: styling for the readiness message/recheck action.
- `tests/client-regression.mjs`, `tests/lobby-regression.mjs`, `tests/worker-harness.mjs`, `tests/integration.mjs`: regression coverage and harness updates.
- `package.json`, README and test reports: reproducible commands and results.

Scenarios, score calculation, fixed round deadlines, ranking, room capacity, anonymous cookies and public access remain in place. No migration is needed.

## Automated validation before publication

- Original-source workerd/D1 reproduction: both the 16-second presence rejection and returning-host authorization ordering defect reproduced.
- Complete five-round workerd/D1 suite: 25 checks passed with a controlled clock, including authoritative scores, unique answer locking, deadlines, reveal, leaderboard, replay and host departure.
- Lobby/D1 regression suite: eight checks passed, including four repeated create/join/start/refresh/replay cycles across independent and reused sessions.
- Client regression suite: six checks passed, including stalled fetch/body deadlines, retry after transient failure, snapshot ordering, live-aging presence and HTTP-preview compatibility.
- Security suite: six checks passed, including concurrent start, token/cookie protections and permission enforcement.
- TypeScript validation, production build and whitespace checks passed.
- Browser preview confirmed explicit one-player readiness text and server-side launch rejection without a stuck button.

Test harness corrections: the final leaderboard comparator now compares identity/name/score rather than volatile per-request heartbeat timestamps. Concurrent raw response bodies are drained to avoid leaving transport resources open. Some earlier real-time local harness runs stalled or timed out; they are not counted as successful runs. The controlled-clock suite is distinct from the real-time production verification.

## Production verification

The repair was published successfully to the existing public HTTPS URL with the same Site and D1 database. Five live lobby checks passed against that endpoint: independent-session permissions/minimum, real 20-second missed-heartbeat launch, >45-second absence rejection, reconnect/refresh recovery, and repeated room creation with reused sessions. Browser interaction confirmed the new two-player readiness message, successful Launch Challenge, answer submission and refresh recovery. A later network interruption also recovered to the correct public welcome state after leaving.

The pre-existing Kesha/CyberTester room was read before and after deployment; both retained 400 points and the finished match state. No production test changed that room.

Some real-time test runs encountered request/transport timeouts. They are not counted as passes. The final test client retries bounded transient state reads and records any retries in its result JSON. It never blindly retries a start or answer command.

Final real-time public match suite: **all 25 checks passed**, including five rounds, a 500–0 synchronized final leaderboard, same-room replay with cleared scores, and host departure. It recovered from 4 timed-out state reads using bounded retries. These retries are recorded explicitly in `tests/launch-fix-live-match-results.json`; they are not represented as uninterrupted network service. The production lobby result is in `tests/live-lobby-results.json`.

Remaining uncertainty: historical per-click reason codes were unavailable, so no claim is made that every past reported click had the same cause. The identified original-code failures were reproduced and repaired. This repair was not retested on the user's physical phone/laptop pair; public independent HTTP sessions and the cloud browser were used.
