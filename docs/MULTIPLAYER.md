# Milestone 4: authoritative multiplayer

Milestone 4 connected the pure engine and local builder to real HTTP/Socket.IO rooms. Milestone 5 provides fitted portrait/landscape screens, paged public information and a separate read-only display capability; see `GAME-SCREENS.md`. Milestone 6 adds private recovery codes, atomic transfer, interrupted-request recovery and Sit Out; see `RECOVERY.md`. No administrator feature or spectator role is added here.

## Host, join and control

Host a valid builder design, enter your player name, and share the eight-character code or `/room/CODE` link. Hosting uploads only that template's content and images into a temporary room snapshot. It does not create a permanent server template or upload personal appearance settings. Save the draft separately if you want to retain editor changes locally.

The creator is the first player and retains host permission on that seat. Start requires 2–5 seated, connected players. Joins are serialized and transactional, and close permanently when the room first starts; Play Again reuses the same seats. Existing seats can reconnect even in a full room.

Each seat has an independent server-generated random player ID, 256-bit token and 120-bit private recovery code. SQLite stores SHA-256 verifiers; private retry responses are separately encrypted with AES-256-GCM. The browser stores its credential under `bid-build.seat.CODE` in localStorage. It never puts secrets in invite links, query parameters, image URLs, public snapshots or application logs. HTTP reads use an Authorization header; Socket.IO supplies the token in its handshake authentication object. Use HTTPS in production and keep one configured `APP_ORIGIN`.

Only one socket can control a seat. A second active connection is refused with an explicit **Take control here** action. Confirmed takeover and private-code recovery prepare a short-lived handoff. The replacement socket consumes it atomically, rotates the token and installs itself before disconnecting the previous controller. Seat identity and original host permission remain; another seat cannot obtain host permission. Closing an obsolete connection cannot disconnect or pause its replacement. A continuous handoff does not cause a false pause, and a real existing pause is never cleared automatically.

Refresh reconnects from the saved credential without creating another player. A network interruption is detected by transport close/Socket.IO heartbeat, so abrupt network loss may take longer to detect than closing a tab. The browser briefly retries a close/attach race; a persistently active connection requires explicit takeover. Local storage must be available before hosting/joining. A random request key saved before HTTP mutations supports retrying a lost create/join/recovery response without duplicate seats or rotations, including across refresh/restart. See `RECOVERY.md` for the verifier, encryption, rate limits and legacy-seat upgrade details.

## State and transaction boundary

`server/rooms/service.ts` serializes room work through one queue per room. Every command authenticates the seat and checks the active controlling socket. The existing engine validates game/run/auction/phase, permissions and amounts. Client timestamps, player IDs, balances and winners cannot override server authority.

Migration 2 adds room snapshots, seat token verifiers, temporary room assets, unique settlements, purchases and command receipts. An accepted command writes the engine snapshot, new settlements, purchase ledger entries and its receipt in one SQLite immediate transaction. A failure rolls all of them back. Acknowledgement and broadcast happen after commit. Settlement and purchase primary keys are `(game_id, run_id, option_id)`; Play Again creates a new run while preserving prior-run ledger rows until room expiry.

Receipts are scoped by `(game_id, run_id, player_id, command_id)`. A retry with the same content returns its original success/rejection receipt, with a fresh public snapshot. Reusing an ID for different command content is rejected. Receipt queries are queued after earlier room commands and return only the requesting seat's receipt. The browser stores the pending command ID/run in sessionStorage before sending, disables further actions while its outcome is unknown, and queries the original receipt on timeout/reconnect. It never blindly resends a buffered command or invents a replacement ID after a lost acknowledgement. A missing receipt prompts review of current state before a new action.

Room snapshots have a public schema version and monotonically increasing room revision, including presence changes. The pure engine's own revision remains private. Joining, reconnecting, acknowledgement and broadcasts all use the same complete authoritative projection; clients do not merge guessed balances or purchases.

## Disclosure and images

The only public projection is `RoomService.snapshot`. It includes the theme/cover, players, balances, current option, previously revealed options, public bid/purchase history and completion information. It excludes the private ordered option list, future IDs/titles/descriptions/images, token hashes, command payloads and receipts belonging to other seats. Room option IDs and asset IDs are new opaque UUIDs independent of authored names/IDs.

Future options remain undisclosed even when End or budget exhaustion marks them unplayed/unclaimed. Results show their count rather than leaking their contents. A new run resets the public reveal boundary; previously fetched content cannot be erased from a player's memory or browser, but is not republished before its new reveal.

Hosting validates the shared portable schema, independently decodes/re-encodes images with Sharp, rejects corrupt/oversized images and stores only re-encoded PNG bytes. Metadata is not retained. Inputs follow `docs/TEMPLATE-FORMAT.md`; the server additionally rejects animated images and caps concurrent image processing. HTTP write-origin checks, bounded JSON bodies and rate limits apply before hosting/joining; socket message size/action-rate limits also apply.

Temporary PNG assets are **SQLite BLOBs under DATA_DIR**, owned exclusively by one room. This keeps the complete small room snapshot and images transactional and avoids orphaned files or unsafe paths. There is no public uploads directory. `GET /api/rooms/CODE/media/ASSET_ID` authenticates the seat, verifies room ownership and the current reveal boundary, then returns PNG with `no-store`, `nosniff` and a restrictive CSP. The client fetches bytes with its Authorization header and creates a local blob URL. Guessing a future asset's real ID still yields no image.

## Pauses, reveals and lifecycle

A player's controlling connection closing during bidding automatically persists a pause. Closing during a reveal also pauses, so the server cannot advance into a new auction with somebody absent. Existing bids, concessions, purchases and balances remain. Bid/Give Up and ordinary progression stay blocked until the host resumes. Reconnection does not resume automatically.

The host can explicitly resume with an absent player. Absence is not a concession and does not erase a binding bid; the same unresolved absence does not keep pausing the room. A new participating connect/disconnect is a new event. The host's own disconnect also pauses; another player never inherits host permission. Confirmed Sit Out is available while paused for an offline non-host: purchases and leading commitments remain, new bids/automatic purchases are excluded, and Resume is required before ordinary settlement. Play Again restores participation.

Settled results have a server deadline (1.8 seconds by default), persisted with the snapshot. The timer and host Next fallback use the same serialized engine path; stale timer callbacks cannot advance a second option. Pause cancels advancement. Restart restores active bidding/reveal rooms paused and clears their timers; host resume starts a fresh short reveal delay where needed. Restoration never repeats settlement or ledger writes. Confirmed End remains the explicit pause exception and honors an existing binding bid exactly once.

Rooms expire after 24 hours of inactivity. Connected controlling players extend expiry every minute; ordinary activity also extends it. Startup and periodic cleanup delete only expired temporary room rows, with cascading assets, seats, receipts and ledger rows. Assets are never shared across rooms or published templates. Future permanent templates require separate ownership/reference rules in Milestone 7.

Run exactly one server process/replica. Stop the old process before replacing it. SQLite, image BLOBs and room state belong on persistent `/data`. This milestone does not verify Docker/Coolify deployment. Existing SQLite backup guidance still applies: take a consistent SQLite backup, not an arbitrary copy of a live database file. Image BLOBs are included in that database backup.

## HTTP and socket surface

| Operation | Transport |
| --- | --- |
| Create a guest room | `POST /api/rooms` with `{ name, template }` |
| Reserve a new seat before Start | `POST /api/rooms/:code/join` with `{ name }` |
| Read current public state | Authenticated `GET /api/rooms/:code` |
| Explicit controller takeover | Authenticated `POST /api/rooms/:code/takeover` with `{ confirmed: true }` |
| Read visible content image | Authenticated `GET /api/rooms/:code/media/:assetId` |
| Connect a seat | Socket.IO auth `{ code, token }` |
| Request resync | `room:sync` acknowledgement |
| Request engine action | `room:command` with the validated engine command envelope |
| Resolve unknown command outcome | `room:receipt` with `{ runId, commandId }` |
| Receive authoritative state | `room:snapshot` |
| Previous controller revoked | `room:revoked`, then disconnect |

Bare infrastructure sockets receive only `server:ready`; they join no room and never count as player presence. Display sockets use `{ code, displayToken }` and can read only the same public projection; they never attach a seat/controller. Private recovery endpoints and request keys are documented in `RECOVERY.md`; display details are in `GAME-SCREENS.md`. Administrator and catalogue endpoints do not exist yet.

## Verification and manual review

`npm test` exercises actual HTTP and Socket.IO clients against isolated temporary SQLite databases, including 2–5-player identical broadcasts, concurrent sixth joins, duplicate/simultaneous bids, ledger failure rollback, paid automatic awards, queued receipts, restart with binding and settled bids, timer/Next races, pause behavior, credential takeover, media secrecy and asset expiry. Existing foundation and pure-engine tests remain in the suite.

The current browser suite uses isolated Playwright contexts and automatically starts its own temporary production server/database. It does not write verification rooms into your ordinary data directory:

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm.cmd run test:e2e
```

The suite covers the original host/join, bidding, refresh/pause/resume, End, receipt lookup, full run, Play Again and takeover behavior, plus Milestone 5 viewport, paging, confirmation and display checks. Screenshots/reports are in ignored `.cache/playwright/`. The former `node scripts/check-rooms-browser.mjs` entry point delegates to this suite; `ROOMS_ORIGIN` is no longer used. Historical Milestone 4 artifacts remain under `.cache/browser-m4/`.

Manual check: open `http://localhost:5173/builder`, choose a starter or load your draft, host, then open the invite link in a separate browser profile. Bid, Give Up, refresh the guest, confirm the room pauses, resume as host, then finish and Play Again. Verify purchases and balances on both screens; follow `RECOVERY.md` for the private-code/device check. Actual phone touch/network behavior, Firefox/Safari and Docker/Coolify remain unverified here.
