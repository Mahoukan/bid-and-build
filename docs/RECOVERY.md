# Seat recovery and disconnections (Milestone 6)

Every new seat, including the host, receives a private recovery code. Open **Game menu → Private recovery code** to Show, Copy or Replace it. Keep a private copy. The public eight-character room code is an invitation, not a recovery credential. On another device, open `/room/CODE`, choose **Recover an existing seat**, enter the private code and confirm taking control. Recovery works in a full or already-started room. A revoked/invalid saved seat also offers recovery from its connection controls.

Recovery restores that seat's authoritative balance, purchases, concessions, binding bids and original host permission. It does not create a player or transfer a different player's host permission. It grants no administrator authentication. Guest drafts and appearance remain local to each browser. Administrator functionality is still Milestone 7.

## Private codes and retry safety

- Codes contain 24 independent cryptographically random characters from a 32-character alphabet: **120 bits**, displayed as six groups of four. Input accepts lower case, spaces and hyphens. The alphabet excludes I/O/0/1.
- SQLite stores a room-scoped SHA-256 recovery verifier and a separate verifier for the 256-bit controlling token. Replacement immediately invalidates the old recovery code and all pending seat transfers. Code replacement does not change identity, balances or the current controller.
- Recovery attempts are limited to **20 per IP and 100 per room per ten minutes**, including failed attempts, with bounded in-memory counters. Counters restart with the process; high code entropy remains the primary guessing protection. The application does not trust arbitrary forwarded-IP headers; behind a proxy, clients may share its conservative IP limit. All mutation endpoints also enforce the configured Origin, JSON limits and general write limits.
- Codes/tokens never enter public snapshots, join links, display links, asset URLs or application logs. The private panel masks the code by default; Show and Copy are explicit. Use the separate shared display for mirroring. Test traces contain isolated fixture credentials and must not become production logs.
- Before create/join/takeover/recover/replace, the browser saves a random request key and payload fingerprint. Retry the same input after a network error, including after refresh. The server commits the mutation and private response receipt together; the same key returns the same result, even if joining has since closed. Reusing a key with different input is rejected. This prevents lost responses from adding a second room/seat or rotating a code twice.
- Retry receipts contain **AES-256-GCM encrypted credentials**, not plaintext secrets. A domain-separated key derives from `SESSION_SECRET`; the operation scope, request-key digest and payload digest are authenticated. The request key itself is stored only as a digest on the server. Keep `SESSION_SECRET` stable across normal restarts. Receipts expire with their room. They cannot restore a token that a later transfer revoked, and an old recovery code cannot replay a recovery receipt after replacement.
- A preserved pre-M6 seat automatically requests an initial code on reconnect if it has none. This does not replace an already-issued code. If browser storage no longer contains a code but its controlling credential still works, use the private panel to explicitly generate/replace it. A lost pre-M6 credential cannot retroactively gain a code; no identity bypass exists.

## Atomic transfer

HTTP recovery/takeover prepares a five-minute handoff token bound to the seat's current token verifier. Preparation alone leaves the original connection in control. The replacement browser saves the returned credential before connecting.

The new socket's attach runs in the room queue. In one immediate transaction it validates/consumes the handoff, rotates the controlling verifier and invalidates other pending handoffs. It then installs the new controller before revoking/disconnecting the old socket. The new connection receives the full current public snapshot. An old socket close cannot remove the replacement or pause it; old tokens cannot read state/media/receipts or issue commands. A continuous handoff does not manufacture a disconnect pause. A real disconnect before handoff still pauses, and recovery never clears that pause.

One seat has one controller. Ordinary refresh uses the saved credential and briefly retries a close/attach race. A persistently active duplicate tab requires explicit **Take control here** confirmation. It never silently steals control. If a connection closes after its transfer committed, reconnecting with the already-saved new token is safe. An expired or superseded handoff requires a fresh recovery/takeover request.

## Pause and permanent departure

Transport close or heartbeat failure pauses bidding **and reveals**, including when the host leaves. Detection of a broken network can take a Socket.IO heartbeat interval. Public balance cards identify disconnected players; selecting the auction status or Game menu shows their full names. No bids, Give Up, ordinary settlement or advancement occur while paused. Reconnecting does not Resume. The host explicitly resumes, including with somebody still absent; absence never concedes or discards a leading bid, and the same old close event cannot repeatedly pause play.

If the host is missing, other players can recover their own seats but cannot gain host controls. The original host must reconnect/recover, or the room eventually expires. Shared displays never count as a player's connection or trigger a pause.

**Sit Out** is an explicit host action for an offline, permanently departed non-host player, available while an active game is paused. The confirmation explains that it applies for this run. Public cards and a live announcement show the status. It preserves owned items, balances and a binding leading bid; it excludes new bids, Give Up and future automatic purchases. Returning with a recovery code does not undo Sit Out. Closing an already-sitting-out player's connection does not pause the remaining participants.

Sit Out cannot settle anything while paused. Resume reevaluates a forced result: a binding leader still pays their existing price, or a sole eligible player pays the opening price. With no eligible players the current option is unclaimed. A funded player who conceded the current option can return next option; later options are not discarded merely because of that concession. If nobody can buy any later option, remaining options are unclaimed. Confirmed End remains the sole settlement exception while paused. Play Again resets Sit Out along with budgets and requires all seats to reconnect before Start; seats and host identity remain unchanged.

## Restart and expiry

Migration 3 adds recovery verifiers, encrypted private-response receipts and pending handoffs without altering migration 2 or deleting existing rooms/assets. Old snapshots default `sittingOut` to false. Restart restores bidding/reveal rooms paused, preserves identity/recovery/purchase data and clears reveal deadlines. Resume restarts the short reveal transition; no purchase is replayed.

Rooms expire after **24 hours of inactivity**. Connected player controllers extend expiry every minute; accepted room activity also extends it. Display-only reads/sockets do not keep an abandoned room alive. Expiry cascades to credentials, handoffs, private/command receipts, ledger and temporary content. Run one server process/replica with persistent `/data`, and stop the old process before replacing it.

## API additions

| Operation | Request |
| --- | --- |
| Recover a seat | `POST /api/rooms/:code/recover` with `{ recoveryCode, confirmed: true, requestKey }` |
| Prepare explicit takeover | Bearer-authenticated `POST /api/rooms/:code/takeover` with `{ confirmed: true, requestKey }` |
| Replace private code | Bearer-authenticated `POST /api/rooms/:code/recovery-code` with `{ requestKey }` |
| Provision a legacy code without replacement | Same endpoint with `{ replace: false, requestKey }` |
| Mark permanent departure | Controlling host socket: `sitOut` command with current command/game/run/auction/phase scope, `playerId` and `confirmed: true` |

Browser requests always include the 256-bit request key. API callers may omit it, but then have no retry guarantee for a lost response. Player credentials return only in private create/join/recovery/takeover/code responses. Display authorization is rejected on all mutation endpoints.

## Verification and owner check

`npm run check`, `npm test` and `npm run test:e2e` cover the engine, real HTTP/Socket.IO, database migration/restart and isolated browser contexts. To run only recovery browser scenarios: `npm run test:e2e -- --grep M6`. See PROGRESS.md for actual results.

Host and join from separate browser profiles. Save both private codes, bid, and close a player's tab: the game should pause with the bid intact. Recover that seat in a fresh profile using the room and private codes, then explicitly Resume as host. Try replacing a code and rejecting its previous value. For a permanently departed guest, confirm Sit Out while paused, then Resume and check the binding bid still settles normally. Use a read-only display alongside it and verify closing the display does not pause.

Actual phone network changes, browser bars/keyboards, touch/zoom, screen readers, Safari/Firefox, TV casting and Docker/Coolify still require machine/device checks. Browser emulation is not a real-device claim.
