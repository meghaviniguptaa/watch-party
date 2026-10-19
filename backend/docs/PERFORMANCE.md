# Watch Party: Performance, Test Conditions and Failure Handling

*Backend benchmarks · Windows PC, Node v24.18.0 · measured 19 October 2026*

## 1. Summary

Every requirement was met with a wide margin. All measurements below come from the benchmark scripts in the repository (`backend/bench`), so anyone can reproduce them.

| Requirement | Result | Status |
| --- | --- | --- |
| At least 10 concurrent users per room | Tested with 12, 25 and 50 clients in one room; the configured limit is 50 | Met |
| Control propagation ≤ 250 ms at p95 (local network) | p95 of 4.9, 6.8 and 10.1 ms at 12, 25 and 50 clients | Met, about 25× margin |
| Playback drift ≤ 500 ms after correction | Steady-state p99 of 46.9 ms; every forced jump corrected within 447 ms | Met |
| Reliable late joins, reconnections, concurrent actions | Late joiners in sync within 17 ms; reconnects resume in about 240 ms; 100 of 100 simultaneous-action rounds converged | Met |
| Documented measurements, conditions and failure handling | This document | Met |

**What p95 means:** 95% of measurements were at or below this value. A p95 of 10 ms means 19 out of 20 actions reached every user within 10 ms.

## 2. How it was tested

- **Machine:** Windows PC, **\[fill in: CPU model, cores, RAM\]**, Node v24.18.0.
- **Network:** loopback (127.0.0.1), which is the best case for the network. A two-device Wi-Fi run is described in section 3.
- **Processes:** the server and the benchmark clients run as separate processes on the same machine, sharing its CPU, with normal background programs open. This is a pessimistic setup.
- **Clients:** headless copies of the project's own client library with a simulated video player. They are not real browsers, so video decoding and buffering are not included. In-browser behaviour was checked by hand.
- **Server settings:** the defaults from `src/config.js`. WebSocket compression is off, messages are capped at 16 KB, and each connection may send 30 messages per second after a burst of 60.
- **How to reproduce:** from the `backend` folder, run `npm run bench:latency` and then `npm run bench:drift`, one after the other and with the app closed.
- **Run-to-run variation:** results differ a little between runs. Two runs at 12 clients gave a p95 of 3.0 ms and 4.9 ms. Pass or fail is judged on p95.

## 3. Control propagation latency

**Method.** One controller sends play, seek and pause. The benchmark measures the time from sending until **every** client in the room has received the resulting state. All timestamps come from one clock, so there is no clock-difference error. Each room size gets 300 operations, paced at 40 ms so the test measures propagation and not the server's rate limit.

**Delay until every client has received the action (milliseconds):**

| Clients | Samples | p50 | p95 | p99 | Max |
| --- | --- | --- | --- | --- | --- |
| 12 | 3,600 | 1.81 | **4.86** | 19.42 | 27.41 |
| 25 | 7,500 | 2.98 | **6.81** | 10.47 | 64.66 |
| 50 | 15,000 | 4.42 | **10.12** | 31.32 | 120.63 |

**Supporting measurements (milliseconds):**

| Clients | Mean | Controller round trip, p95 | Server processing, p95 | Lost broadcasts |
| --- | --- | --- | --- | --- |
| 12 | 2.31 | 4.60 | 4.29 | 0 |
| 25 | 3.37 | 5.93 | 6.65 | 0 |
| 50 | 5.51 | 9.31 | 10.94 | 0 |

**Concurrent actions.** In each of 100 rounds, every client sent a control message in the same moment. After each round, all clients had to hold exactly the same state.

- All three room sizes converged in 100 of 100 rounds.
- Duplicate actions are merged into one. When many people press pause together, only the first changes anything. This happened for 66 of 1,200 messages at 12 clients, 0 of 2,500 at 25 clients and 68 of 5,000 at 50 clients. The count depends on how the messages happen to interleave.

**Reading the results.**

- Delay grows gently with room size, because every action is sent to more people.
- The slowest single cases (27 to 121 ms) are rare outliers, most likely garbage collection or other programs on the same machine. They still stay under the 250 ms limit.
- The 99th percentile stays between 10 and 31 ms.

**Network conditions.** All measurements were taken on loopback (server and clients on one machine), which excludes real network delay. On a typical home or campus Wi-Fi, expect a few extra milliseconds to a few tens of milliseconds per action. That is far below the 250 ms limit, but this has not been measured. A two-device run is listed as future work.

## 4. Playback drift

**Method.** Twelve clients each used a player whose clock was wrong by a random amount up to ±2%, like a video decoder that does not keep perfect time. Drift is the gap between a client's position and the room's true position, sampled every 100 ms.

**How correction works.** Each client checks its position every 500 ms:

- **Within 40 ms:** do nothing.
- **40 to 400 ms off:** change the playback speed by up to ±5%, which viewers do not notice.
- **More than 400 ms off:** jump to the right position.

Clients also report their drift every 2 seconds. The server sends a correction to anyone more than 400 ms off, and broadcasts the room position to everyone every 5 seconds.

| Scenario | Result |
| --- | --- |
| A. Steady state, 15 s, natural clock error only | Median 40.1 ms, p95 45.3, p99 46.9, max 49.0 |
| B. 20 forced jumps of 0.3 to 1.5 s on random clients | All 20 corrected. Time to get within 500 ms: median 218 ms, p95 443, max 447 |
| C. 5 late joiners while the room is playing | In sync after a median of 12.3 ms, max 16.6 |
| D. 3 connections cut, host seeks to 300 s while they are offline | Reconnected and in sync after 241 ms, same participant identity |

## 5. Failure handling

### Connection problems

- **A client drops** (network loss, closed tab). The server marks the person offline and tells the room. Their place is kept for 30 seconds. Reconnecting with their saved id and secret token resumes the same participant and sends a fresh snapshot of the room.
- **A half-open connection.** The server pings every 10 seconds. A client that misses the next round is disconnected, which starts the 30-second grace period. Detection takes about 10 to 20 seconds.
- **A client reconnecting.** It retries with exponential backoff (200 ms × 2ⁿ, capped at 10 seconds, with random jitter). It stops if the room no longer exists or its token is invalid.
- **The host drops.** After 8 seconds, host rights pass to another connected participant.
- **The same person connects twice.** The new connection takes over and the old one is closed.
- **A connection that never joins a room.** It is closed after 10 seconds.

### Keeping playback consistent

- **Late join.** The join reply includes the full state, playlist, chat and polls. The client calculates the correct position from the saved time and applies it at once, so late joiners are in sync within a few milliseconds.
- **Clocks differ between devices.** Each client measures its offset from the server by exchanging timed pings: 8 at the start, refreshed every 10 seconds. It keeps the lowest-delay sample out of the last 12, because that one has the smallest error.
- **Player drift.** Handled by the nudge-or-jump rules in section 4.
- **Concurrent or duplicate actions.** The server handles one message at a time, so there is one strict order. Each change raises a version number. Play and pause that change nothing are ignored, and clients discard any state older than the one they hold.

### Abuse and overload

- **A flood of messages.** Each connection may send 60 messages in a burst, then 30 per second. Chat is limited to 1 per second and reactions to 5 per second. Over the limit, the sender gets an error and nothing is broadcast.
- **Malformed or oversized messages.** Every message is validated. Messages over 16 KB and binary frames are rejected, and only the sender sees the error.
- **A slow client.** If a client falls more than 1 MB behind, the connection is closed so it cannot hold up the room. It can reconnect and catch up.

### Cleanup and limits

- **Abandoned rooms.** A room that stays empty for 5 minutes is deleted. A cleanup check runs every 30 seconds.
- **Capacity.** The limits are 50 people per room and 1,000 rooms.
- **Server restart.** All state is kept in memory, so rooms are lost on restart. Clients see "room not found" and stop retrying. Saving state in a database such as Redis would be the next step.

## 6. Known limitations

- Loopback results do not include real network delay. Re-run on a real network for the final figures.
- Simulated players have no video decoding or buffering. Remote video hosts that do not support partial downloads (HTTP range requests) cannot seek, and slow hosts add buffering time that no sync logic can remove. The web app shows a warning and avoids restarting seeks that are still loading.
- The server is a single process with in-memory state, so it does not scale across several machines.
