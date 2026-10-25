# Codex implementation milestones

Use High reasoning for this build. Start with FIRST-PROMPT.txt, which requests Milestone 1. After testing and committing that stage, ask for the next milestone by number. These prompts are implementation instructions, not claims that the game already exists.

Every milestone inherits AGENTS.md and PROJECT_BRIEF.md. Preserve the agreed rules, keep PROGRESS.md current, implement working code, run relevant checks and stop at the review checkpoint. Each stage builds on the existing files; never regenerate the whole project over working code. Fix failures before moving on. If a required tool cannot run, report the limitation and the exact user action needed.

**Milestone 1 — Foundation and local runtime**

```text
Implement Milestone 1 using AGENTS.md and PROJECT_BRIEF.md.

Inspect this folder and Node/npm/Git availability. Create a small TypeScript project using React + Vite for the client, Express + Socket.IO for the server, shared validation/types, a separate pure engine module, and SQLite persistence with migrations. Use Node 24 LTS, npm and one root package-lock.json. Choose maintained compatible dependencies and record versions. Support Windows PowerShell and Linux without shell-specific package scripts.

Development: frontend port 5173, backend port 3000, Vite proxy for /api, /health, /media and /socket.io including WebSocket upgrades. Production: one Node process serves the built client, API and sockets on PORT, bound to HOST=0.0.0.0. Direct navigation to app routes must work without swallowing API errors into the SPA fallback.

Create a simple responsive shell for /, /builder, /room/:code, /display/:code and /admin. /room/:code will combine lobby and gameplay; host controls are part of a player's view. Do not add a spectator route or separate non-playing host.

Create .env.example with NODE_ENV=development, HOST=0.0.0.0, PORT=3000, DATA_DIR=./data, APP_ORIGIN=http://localhost:5173 and SESSION_SECRET left blank with an explanation. Add npm run setup to create .env only if missing, generating a cryptographically random secret without printing it; never replace existing settings. Load root .env consistently from server and CLI commands. Ignore local runtime data and secrets in Git. Create the data directory and apply migrations idempotently at startup. Add /health that reflects successful initialisation.

Required working scripts now: setup, dev, check (lint + typecheck), test (non-watch), build, start and db:migrate. Add test:e2e and admin commands when their features exist; do not create fake passing placeholders. Include a small meaningful runtime/schema smoke test and a README with exact commands. Add a multi-stage Dockerfile skeleton and .dockerignore, refined in Milestone 9. Use a current Debian-based Node 24 image and a non-root runtime.

Run setup/install/check/test/build and start the app to verify /health and page routes when the environment permits. The owner should be able to run npm run dev and see the shell. Update PROGRESS.md and report any installation blocker honestly. Stop after Milestone 1.
```

User check: the home and builder shell load, and `http://localhost:3000/health` reports ready. Game features are not expected yet. Suggested commit: `M1: application foundation`.

**Milestone 2 — Deterministic auction engine**

```text
Implement Milestone 2. Keep engine code independent of React, sockets, database, wall clocks and randomness. Inject IDs/time where required so transitions are deterministic.

Represent 2–5 player seats, hostPlayerId, game/run ID, current option ID/index, phase, per-player balances, high bid/leader, concessions, bids, purchases, unclaimed options and pause state. Use stable IDs rather than hard-coded player positions. Return validated state transitions/events for commands. Shared schemas reject unsafe integers, decimals, invalid settings and oversized input.

Implement the exact auction contract in AGENTS.md: winner pays once; losing bidders pay nothing; opening price and increment are separate; no self-raise or leader withdrawal; Give Up is irreversible for this option only; eligible last player buys at opening price; automatic purchases consume money and stop when nobody can afford the next option. One broke player does not remove competition between the others. Skip only unbid options. Bet All is a normal legal bid for the entire balance. No bidding timer or subjective scoring.

Use lobby, bidding, reveal and finished phases, plus a pause mechanism preserving its underlying phase. While paused, reject bids/concessions and settlement/advancement. Finished-game commands and stale run/option commands cannot mutate state. Play Again creates a fresh run ID, resets budgets/collections/concessions and returns existing players to a lobby before Start. Keep host identity.

Deal explicitly with host ending a game while a bid is live: settle any existing binding leading bid once at its accepted price, then mark all later options unplayed/unclaimed and label the result incomplete. Do not erase the committed bid. End is a confirmed terminal host action, including when paused; ordinary bidding and advancement remain blocked while paused.

Test 2, 3, 4 and 5 players; reject start with 1 or 6; minimum opening and raise; equal/late bids; all-in; leader restrictions; Give Up before a bid causing a minimum-price award; 0-eligible and host-skip outcomes; one broke player with two funded opponents; $3 funding exactly three $1 automatic purchases; no negative/zero-price award; reset; paused commands; and ending with a leading bid. Assert conservation of balances versus ledger costs. Do not write an impossible everyone-concedes test that contradicts the forced-last-player rule.

Run check/test/build, document edge-case choices and stop after the verified engine. Update PROGRESS.md.
```

User check: review the reported engine cases; a playable UI comes later. Suggested commit: `M2: tested auction rules`.

**Milestone 3 — Local builder, images and template portability**

```text
Implement Milestone 3 using the shared schema and samples/dragon-game.json as the initial portable format. Preserve its format/version and core field names. Validate unique option IDs and preserve order. For optional images, define a versioned portable representation containing MIME type and base64 data or a validated data URL; null means no image. Document the representation and round-trip it in tests.

Build the real builder: title, description, cover image upload/view/remove, starting currency, currency symbol, opening price, increment, options with title/description/image, add/duplicate/remove/reorder, move-up/down keyboard alternatives, and live card preview. No AI or external image service is needed. Use the plain default visual style for now.

Support multiple named local drafts in IndexedDB, Save, Load, Delete, duplicate draft, and import/export of complete versioned JSON including images. Show Saved to this browser and unsaved-change/error states. Handle storage quota/write failures honestly. Persist actual image bytes, not expiring blob URLs. Downsize/re-encode images, enforce documented file/pixel/total limits, and preserve transparency when appropriate. Imported text is data, not executable HTML. Do not upload drafts or personal backgrounds while editing or autosaving.

Provide the sample dragon game as an explicitly selectable starter draft. Save/export/import/refresh must all retain fields and images. Keep the future Host action clearly labelled as awaiting multiplayer until Milestone 4 rather than faking a room.

Test schema rejection, empty/invalid fields, duplicate option IDs, draft persistence, image survival and export/import round-trip. The builder/admin forms may scroll; the fitted gameplay requirement still applies to the later game screens. Run check/test/build and relevant browser checks if available. Update PROGRESS.md and stop.
```

User check: edit the sample, add an image, save, refresh, export, import into another browser profile and verify the image. Suggested commit: `M3: local game builder`.

**Milestone 4 — Real rooms, transactions and multiplayer**

```text
Implement Milestone 4 by connecting the engine, builder and database through HTTP and Socket.IO. No client-authoritative balances or winners.

A guest can host a validated local draft, temporarily uploading its game content/images. Room creation also creates the host's player seat and grants room host permission to that seat. Generate collision-resistant public room codes. Add join-by-code/link, lobby list and Start with 2–5 connected player seats. Joining is transactional so simultaneous requests cannot exceed 5. New player joins close after Start; there is no spectator fallback. Rejoining is not a new seat. The host receives the same budget and bidding controls.

Provide stable random player/session credentials and automatic same-browser refresh recovery now. Add explicit active-controller handling so two tabs cannot independently act as the same player. Basic disconnect pause and host resume must work now; private recovery codes and thorough reconnect edge cases are Milestone 6.

Process commands sequentially per room and persist snapshots, purchases and command receipts in a transaction before acknowledgements/broadcasts. Dedupe command IDs, scoped by player and game/run. Enforce one settlement per game/option at the database boundary. Retry of an already-accepted command returns its original receipt; it never re-applies payment. Resync from a full versioned authoritative snapshot on join/reconnect. Stale, unacknowledged commands are not blindly queued into a later auction. When a client loses acknowledgement, query the command receipt/current snapshot rather than inventing a new ID and charging again.

Use one explicit public-state projection containing only current/revealed options, names, balances, current bids and public history. Future titles/descriptions/images/order are absent. Use authorised media routes and opaque IDs, not an unrestricted static uploads directory that exposes future assets. Catalogue and display responses use this same disclosure boundary. The creating browser already knows its local draft; do not redistribute it to other devices.

Implement server-controlled reveals and a host Next fallback with exactly one advance. Persist enough to restore active rooms paused after restart, without repeating purchases/reveal transitions. Give each Play Again a new run ID. Copy templates into room snapshots. Clean up expired temporary rooms/assets without touching published templates or live referenced assets.

Add a minimal functional room UI to exercise real bidding. Test real Socket.IO clients for 2–5 seats, concurrent sixth join, same-price simultaneous bids, duplicate commands, one charge, room isolation, blocked late join, refresh without a new seat, host bidding, missing/bad credentials, future-field/media leaks and restart restoration. Use isolated temporary databases.

Run check/test/build, update PROGRESS.md and stop.
```

User check: host in one browser profile, join in another, bid, give up, refresh and finish a game. Suggested commit: `M4: authoritative multiplayer rooms`.

**Milestone 5 — Finished game screens and optional display**

Milestone 10 supersedes only the acquired-build/result player tabs, item pages and related checks below. Preserve the remaining fitted-layout, control, privacy and display requirements.

```text
Implement Milestone 5 with two deliberate responsive compositions: landscape website and portrait phone. Read the layout requirements in PROJECT_BRIEF.md. /room/:code is a full player interface in both orientations, with secondary host controls only for the host player.

Fit lobby, bidding, reveals and results in the visible viewport at 360x640, 390x844, 1280x720 and 1440x900 CSS pixels. Keep current option, leader/high bid, own balance, all player balances and Bid/Give Up visible. Use image contain behaviour, bounded layout regions, readable type and touch targets. Account for dynamic browser height, safe areas and keyboards. Do not merely apply overflow:hidden over inaccessible content or disable zoom.

Use tabs/paged panels for builds, purchase prices, full descriptions, bid history and final results. There should be no main game-page scroll in ordinary play. Include empty, disconnected, paused, insufficient-funds, leading, outbid, conceded and unclaimed states. Make keyboard focus and screen-reader status announcements useful without flooding announcements.

Put Bet All in a separate secondary action panel, with amount confirmation and Cancel. Implement custom bid entry without hiding the confirm/cancel controls behind the phone keyboard. The host's Start/Pause/Resume/Next/Skip/End/Play Again controls must not clutter ordinary bidding; no manual winner or balance editing. End requires confirmation and follows the engine's committed-bid settlement rule.

Any player can open the optional /display/:code view using a separate read-only display capability. It reuses landscape presentation, has fullscreen controls, and cannot bid, claim a seat, restore a player or administer anything. Do not put player credentials into the display link. Opening/closing it neither consumes a player slot nor affects presence. Hide recovery codes and admin data when casting. Provide ordinary fullscreen/display-link instructions; native casting SDK integration is out of scope.

Results show acquired options, prices, total spent, remaining money and unclaimed/unplayed options. No winner based on quantity/spend. Play Again returns current players to a fresh lobby.

Add Playwright browser tests and npm run test:e2e. Use separate browser contexts for players. Check viewport overflow AND visibility/clickability of controls, full access to secondary content, long labels, 2/3/5-player layouts, results paging and display permissions. Capture and inspect screenshots if tools permit; describe any real-device keyboard/casting checks still needed. Run relevant checks, update PROGRESS.md and stop.
```

User check: complete a game on desktop and in a portrait phone viewport; no page scrolling is needed. Open and close the shared display during play. Suggested commit: `M5: fitted game screens`.

**Milestone 6 — Recovery codes and disconnection behaviour**

```text
Implement Milestone 6 fully, without changing auction economics.

Give every player a private, cryptographically random, room-scoped recovery code. It must be practical to copy/type, contain sufficient entropy, and have a server-side verifier plus attempt rate limiting. Show it only privately with Copy and Replace Code. Never broadcast/log it or include it in public join/display links. Room code plus the private code recovers the existing seat on another device, even in a full five-player room. Replacement invalidates the previous code.

Transfer control atomically: old controlling credentials/sockets lose permission, the new session receives current authoritative state, and closure of an old socket cannot mark the new controller disconnected. Restore balances, purchases, concessions and accepted bids. Host recovery restores host permission only for the original host seat. Recovery never grants admin account access. Appearance preferences and guest draft files do not transfer.

Automatically pause on player disconnection during bidding, including the host. Freeze ordinary settlement and advancement; reject bids/concessions. Clearly identify the absent player. A reconnect does not automatically resume: the host resumes explicitly. Resuming with an absent player does not concede for them, remove their binding bid or repeatedly retrigger the same pause. Shared displays do not supply player presence and their disconnects do not pause play.

If the host deliberately marks a permanently departed player Sit Out, confirm and announce it; retain owned items and any existing leading commitment, and exclude that seat from future new bids/automatic purchases. Temporary disconnection alone never applies Sit Out. If the host is missing, anyone can still recover their own seat but no other player/admin gets host powers; keep the game paused until the host recovers or the room expires.

After a server restart restore unfinished rooms paused with server-authoritative state. Persist recovery verifiers/permissions as needed. Expire rooms after the documented inactivity window (default 24 hours); active players extend it, display-only traffic does not keep an abandoned room alive forever. Reject expired credentials cleanly.

Test refresh, network loss during bidding, reconnect after missed events, host recovery on a new context, takeover without false pause, old-session actions rejected, wrong/replaced codes, full-room recovery, display disconnect, host resume while absent, explicit sit-out, and restart without another charge. Test paused next/reveal transitions as well as bidding.

Run check/test/build and focused e2e checks; update PROGRESS.md and stop.
```

User check: bid, disconnect a player, observe the pause, recover using another browser/device, and resume as host. Suggested commit: `M6: reconnect and recovery`.

**Milestone 7 — Administrator template collection**

```text
Implement Milestone 7 with server-side administrator authentication, durable sessions and server-enforced permissions. There is no guest registration requirement and no public admin signup. Use strong password hashing, production Secure/HttpOnly/SameSite cookies, CSRF/origin protections and login limits. Keep the administrator session separate from room recovery credentials.

Provide interactive npm run admin:create and npm run admin:reset-password commands usable after npm run build and inside the production container. They prompt for credentials privately, never place passwords in arguments/logs, do not reset unrelated accounts, and use the same configured database as the app. Production commands must work without development dependencies. Account creation is independent of a game being in progress.

Admin UI: add, list, edit, duplicate, delete with confirmation, publish/unpublish templates; edit all settings/options/images/order. Use the builder components. Permanent storage is reserved for these authorised writes. Guests may browse published titles/covers and host a server-created room snapshot; the catalogue must not leak all future options. An admin joining a game is an ordinary player, counts within five, and cannot control another host's room or change live money.

Template edits/deletion must not mutate active room snapshots or break their images. Guest local drafts remain local and playable without login. On hosting, only a temporary game snapshot/assets go to the server. Apply upload type/size/pixel limits and safe re-encoding on the server as well as the client. Store assets with reference-aware cleanup and constrained paths. Do not accept arbitrary active HTML/SVG uploads or fetch arbitrary remote URLs.

Test anonymous create/update/delete rejection via direct HTTP, admin CRUD/publish lifecycle, guest hosting without login, game-recovery code not granting admin, admin not granting host powers, safe asset references after template deletion, image validation and session expiry/logout. Use test credentials only in isolated tests. The owner creates their actual admin privately using the CLI.

Run check/test/build and focused e2e tests, update README/PROGRESS.md with exact bootstrap steps, and stop.
```

User check: create your admin in a terminal; publish a template; host it as a guest; edit/delete the source while the active room remains intact. Suggested commit: `M7: admin template collection`.

**Milestone 8 — Local appearance and final viewport polish**

Milestone 10 supersedes build/result pagination below with shared collections and bounded vertical overflow. Description/history paging and all appearance/privacy requirements remain.

```text
Implement Milestone 8. Add one simple Appearance panel with live preview, light/dark mode, accent colour, background-image upload/preview/removal, glassy surface option, and Minimal/Glass/Neon/Paper presets. Keep a clean default and Reset to Defaults.

Persist only local preference data: localStorage for small settings and IndexedDB for background bytes. Do not send preferences/backgrounds to the backend, include them in template exports or change other players' views. Reset only appearance; retain drafts and player credentials. A separately opened display uses its browser's preferences. Normal screen mirroring naturally mirrors the page being cast.

Use shared design tokens so themes preserve layout and actions. Ensure contrast, background overlays, readable glass panels, an opaque fallback, reduced motion and stable button placement. Validate local image limits and show quota/storage failure without falsely claiming success. Background selection must not trigger game-content upload. Reconnection on another device keeps that device's local appearance.

Recheck the two viewport compositions after applying every preset, custom accent, background and glass. Test 2, 3 and 5 players, long names/options, paused overlays, the all-in dialog, keyboards, final results and display mode. Build/history/detail paging must remain usable without main-page scroll at the four target viewport sizes. Do not turn the interface into a tall landing page or add decorative dashboards unrelated to play.

Use browser tests to show preference persistence on refresh and isolation between separate browser contexts, no appearance data in requests, reset without identity/draft loss, and visible/clickable primary controls. Also inspect screenshots; an overflow-height assertion alone does not prove the interface works.

Run check/test/build and e2e tests. Record remaining real-device checks honestly. Update PROGRESS.md and stop.
```

User check: customise one browser, refresh, then compare another player/device. Both should have independent settings and fully usable controls. Suggested commit: `M8: local themes and responsive polish`.

**Milestone 9 — Docker, CI and deployment handoff**

```text
Complete Milestone 9 against all documents and ACCEPTANCE-CHECKLIST.md. Review the actual implementation for missing features and incorrect rules; fix them before declaring readiness.

Finish a multi-stage Dockerfile using Node 24 LTS, a non-root runtime and an owned /data directory. Build client/server/shared code; serve all production traffic from one process on 0.0.0.0:3000 by default. Keep SQLite and uploaded assets under DATA_DIR. Exclude .env, databases, personal files and unnecessary development artifacts from the build context. Ensure production admin/migration commands and their dependencies are included. Health reports ready only after migrations/database initialisation.

Graceful shutdown stops new commands, finishes or rolls back in-flight transactions, persists state and exits. On startup, interrupted games recover paused. This is a single-instance design: no cluster/multiple replicas and no overlapping old/new room engines. Confirm docs/COOLIFY-SETUP.md matches the implemented environment variables, commands, UID/storage permissions, port, health route and stop-before-start deployment approach. Correct the guide if implementation details changed, without changing the product scope.

Create CI for clean npm ci, check, test, build and representative Playwright tests on Node 24. Use isolated test storage. Build the Docker image and run a persistence smoke test with a named volume when Docker is available: create data, stop/recreate the container, verify the data and room recovery. If Docker is unavailable, do not claim it passed; provide the exact commands for the owner or CI to run.

Update README with local development, phone-on-LAN testing, admin bootstrap/reset, migrations, backup/restore and deployment. Document consistent SQLite backup with its images; never suggest copying a live database file alone as a guaranteed backup. Verify restore against a separate directory. Include at least one CI Linux build so Windows-only success does not hide filesystem-case/import issues.

Audit all requirements: 2–5 including host; no spectator; local guest drafts/themes; immutable room snapshots; paid auto-awards; recovery; pause; no hidden controls or future-option leaks; admin CRUD; fitted portrait/landscape; optional display. Finish a real 2-player and 5-player flow using separate contexts and the sample template. Keep any manual device/hosting checks as outstanding in PROGRESS.md rather than marking them passed.

Do not push or deploy automatically. Report files changed, checks run and results, remaining manual checks, exact local launch commands, Docker commands and the next GitHub/Coolify steps. The owner reviews and publishes after local verification.
```

User check: complete ACCEPTANCE-CHECKLIST.md, then follow docs/COOLIFY-SETUP.md. Suggested commit: `M9: deployment-ready build`.

**Milestone 10 - Compact game board and full-build comparison**

Implement the focused UI refinement in the existing project. Preserve all uncommitted M1-M9 work; no reset, commit, push or deployment. M9 Docker, hosted Linux CI, physical-device and Coolify checks remain outstanding.

Show acquired collections together using a reusable compact thumbnail/name/paid-price presentation. Names must wrap and stay identifiable without hover or opening details. Full descriptions/larger images open on click/tap/keyboard; missing images have a fallback. Never expose unrevealed future options.

Landscape: bounded current auction with controls, all players' collections and name/balance/item counts in stable seat order. Portrait: current option/high bid, own/all balances, pause/connection and primary controls stay visible; persistent Your build and one Compare builds surface showing everyone with current status and a clear return. Preserve separate confirmed Bet All and secondary host controls. Purchases appear once after authoritative settlement, with a brief reduced-motion-aware highlight.

Results: every player's full collection, paid prices, spent total and balance together as the main surface. Aligned desktop columns; readable phone player sections, never five narrow columns. Keep Play Again secondary; distinguish unclaimed/unplayed without future leaks or scoring.

Fit 360x640, 390x844, 1280x720 and 1440x900. Aim for all 12 sample results in one viewport for ordinary 2-3 players, including uneven ownership. Large collections use one bounded vertical scroll surface with clear/sticky player headings; no nested/horizontal scroll, clipped names, item carousels, player selectors, hidden items or new template-size limit. Accessibility zoom/text enlargement may reflow. Reduce excess spacing/artwork before type/touch targets.

Reuse authoritative snapshots, protected media, shared display and theme tokens. Preserve engine, schema, money, recovery, pause, permissions, privacy and local storage. Update conflicting AGENTS.md, PROJECT_BRIEF.md, ACCEPTANCE-CHECKLIST.md and older milestone notes.

Run check/test/build and browser regressions. Replace only superseded pager expectations; retain meaningful coverage. Cover 2/3/5 seats, empty/uneven builds, full sample, long collections/names/titles, missing images, keyboard details, overflow reachability, fitted actions and read-only display. Inspect screenshots at all four sizes and representative light/dark/glass/background themes. Record actual results and manual limitations in PROGRESS.md. Finish with launch URL, short manual review, files changed and suggested commit. Stop for review.

Suggested commit: `M10: compact game board and full-build comparison`.

**Continuation prompt**

```text
Continue Bid & Build. Read AGENTS.md, PROJECT_BRIEF.md, CODEX_PROMPTS.md and PROGRESS.md, then inspect the current code. The previous milestone has been reviewed. Implement the next incomplete milestone only, including its relevant checks and progress update. Preserve the working implementation and stop at the milestone checkpoint.
```

**When something fails**

```text
Fix this issue in the current milestone. Read the project instructions and PROGRESS.md, reproduce the problem, identify its cause and make a focused correction. Preserve the agreed rules and existing working features. Add a regression test where it verifies a real behaviour, run the relevant checks and update PROGRESS.md. Do not start the next milestone or rebuild the project from scratch.

What I did:
[describe the steps]

Expected:
[expected behaviour]

Actual:
[observed behaviour and relevant error text; omit secrets/recovery codes]
```
