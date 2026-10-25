# Bid & Build project instructions

Build a real multiplayer website for a GitHub repository deployed through Coolify. The owner uses VS Code on Windows. The application is implemented; preserve its working features.

Read README.md and the relevant operational guides in docs/ before making changes. The user's latest instructions take precedence. Preserve the product and auction rules below.

**Working agreement**

- Complete the requested change, run relevant checks, correct failures and stop within the requested scope. Make reasonable implementation decisions without asking about routine choices.
- Write working files. Plans and mock data alone do not complete a milestone. Clearly label development fixtures and never use fake state in the finished game.
- Preserve existing user changes. Do not reset the repository, overwrite unrelated files, publish to GitHub or deploy without the user's instruction. Local source edits and necessary dependency installation are part of the requested build. Respect the environment's permission controls.
- Use npm with one root package-lock.json and cross-platform scripts. Do not mix package managers. Use Node.js 24 LTS and pin tested dependency versions through the lockfile; confirm current package compatibility when installing.
- Keep a small understandable structure: client/, server/, shared/, engine/, tests/ and docs/, or equivalent clean boundaries. Do not create unnecessary services. React + Vite + TypeScript, Node + Express + Socket.IO, SQLite, and a single Docker app are the agreed stack.
- Use maintained SQLite bindings compatible with Node 24, Windows development and Debian-based Docker. Document any native build requirements. Prefer a straightforward adapter with transactions over a second database service.
- Never invent test results. Report checks actually run, blockers, and manual checks still needed. Do not weaken tests to conceal an application bug. Avoid tests that only repeat implementation details.
- After each stage, report the result, commands run, the launch URL, a short manual check and a suggested commit message. Update the relevant documentation when behaviour or operating instructions change.

**Product requirements**

- Exactly 2–5 player seats, including the host. Optimise for 2–3; fully support 4–5. The room creator gets a player seat automatically. Admin is a template-management account permission, not a separate game role or special bidder.
- No spectator player, spectator join flow or late player joins. An optional read-only shared display consumes no seat and does not count as a player's connection. Any player may open it.
- Guest drafts and personal appearance preferences remain in that browser. A guest can host without login; only the temporary game snapshot and its content images go to the server. Personal backgrounds and theme preferences never enter room state or uploads.
- Admin can create, edit, delete, publish and unpublish permanent templates and options. All corresponding API routes enforce authentication and authorisation. Editing/deleting a template cannot alter live room snapshots or remove assets they still need.
- Appearance: simple default, light/dark mode, accent colour, local background image, glass surfaces, and Minimal/Glass/Neon/Paper presets. Maintain readability and reduced-motion support. Reset appearance does not erase drafts or identity.
- Two fitted gameplay layouts: landscape website and portrait phone. No game-page scrolling at normal target viewports. Show acquired collections together: all players inline on landscape, persistent Your build plus one Compare builds surface on portrait, and everyone together in final results. Use readable wrapping names, thumbnails and prices, never player-selection tabs or item carousels. A bounded vertical collection/comparison scroll area deliberately replaces item pagination when content cannot fit legibly; no nested or horizontal scrolling. History/descriptions may use pages and details dialogs. Keep the current option, high bid, own balance, all player balances and main actions visible during bidding. Builder/admin forms and accessibility reflow may scroll. Do not clip controls or disable zoom to fake success.
- Phones contain all public information. The shared display uses the landscape composition without player actions. Neither public payloads nor accessible asset routes may leak future option details. A template author already knows what they authored.

**Auction contract**

- Default budget 20, opening price 1, increment 1, display symbol $. Fictional whole-number currency only. Opening price and increment are separate settings. Bids may jump above the minimum.
- Only the winner pays, exactly once at settlement. A leader cannot raise their own bid or withdraw it. Give Up removes a non-leader from the current option and resets next option.
- If no opponent who has not conceded can afford the next raise, the accepted leader wins at their existing bid. With no bid and one remaining eligible player, charge that player the opening price. With no eligible players, mark unclaimed.
- At each new option: 2+ eligible players auction normally; 1 buys automatically at the opening price; 0 means unclaimed. Never grant free items or allow negative balances. One broke player does not end other players' bidding.
- Give Up actions are sequential. The final eligible player can be forced to buy at the opening price before another queued concession arrives. Host Skip is permitted only when no bid exists. Do not promise a simultaneous everyone-passes mechanism.
- Bet All is separated from Bid/Give Up and requires an exact-amount confirmation. No default auction countdown. Short reveal transitions must be server controlled and recoverable.
- A confirmed host End action settles an existing binding leading bid once, marks later options unplayed/unclaimed and ends with an incomplete result. This terminal action is the explicit exception to the pause rule; ordinary settlement and advancement remain blocked while paused.
- Final results compare builds, prices and balances; do not invent scoring, combat or a winner.

**State, identity and recovery**

- All game authority is on the server. Pure deterministic engine transitions must be separate from transport, database and React.
- Process room commands in order. Validate actor, game/run ID, auction ID, phase and amount. Persist accepted state and purchase ledger transactionally before acknowledging/broadcasting. Dedupe commands and enforce one settlement per game/option even after retries and restart.
- Stable player identity is independent of socket.id. Refresh reconnects automatically. Private room-scoped recovery codes transfer a seat to another device; invalidate previous controlling sessions. One seat has one controller, with an explicit takeover/recovery flow for another tab/device.
- Recovery of the host's seat restores its existing host permission. A different player never becomes host through recovery. Admin login is separate and is never restored by a game code.
- Automatically pause on player disconnect while bidding. Freeze ordinary settlement/advancement while paused; reject Bid/Give Up until host resumes. Shared-display disconnects have no effect. Host reconnect does not automatically resume. Host may intentionally resume with somebody absent; absence is not an implicit concession. Do not loop the same disconnection event into repeated pauses.
- Temporary disconnects preserve the slot and full state. Explicit host Sit Out for a permanently departed player preserves purchases and any binding leading bid. Document this distinction clearly.
- Persist rooms and ledger; restore interrupted games paused after restart. Single server process/replica. Use a persistent /data directory and deployments that stop the old process before starting the replacement.

**Validation and implementation boundaries**

- Validate inputs on the server; reject negative, fractional, unsafe or oversized numbers and overlong data. Use image type/size limits and re-encoding. Do not accept executable HTML or arbitrary remote file paths as images.
- Use server-side admin sessions with secure production cookies, CSRF/origin controls and login/recovery rate limits. Keep secrets out of client bundles, URLs, logs and Git. Use generated local secrets and interactive admin setup/reset commands.
- Meaningful checks include pure engine cases, real multi-client Socket.IO integration, persistence/recovery, authorisation, future-option leakage and responsive browser interactions. Tests use isolated temporary databases and never erase the user's data directory.
- Do not add payments, AI APIs, social accounts, Redis, external file hosting, trading, combat or a spectator system. They are outside this build.
- This AGENTS.md is a project instruction file, not a skill. Keep it in the repository root.
