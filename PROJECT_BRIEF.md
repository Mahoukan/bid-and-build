# Bid & Build

Working project brief · 22 October 2026 · 2–5 players, player permissions, fitted layouts, appearance and recovery confirmed

A browser party game where players use a limited fictional budget to bid on traits, possessions or experiences and assemble their own themed creation. Examples include Build Your Perfect Dragon, Build Your Perfect Life and Build Your Ultimate Villain. Spending heavily secures a desirable option but leaves fewer opportunities later.

This brief builds on the existing Bid & Build plan. It supports 2–5 players, minimum-price automatic awards, local guest drafts, an admin-managed template collection, surprise item reveals, and full public information on player phones. The host is always a player; administrator access is an additional permission, not a separate in-game position. There is no spectator role. Additional operational defaults below are proposals for the first implementation.

Confirmed visual and storage requirements: keep the interface simple and customisable; save personal appearance preferences only in the current browser; keep guest designs as local drafts; support reconnection; and let authenticated administrators add, update and delete permanent game templates and their options. Appearance controls include light/dark mode, accent colour, a background image, a glassy look and additional theme presets. Private recovery codes allow recovery on another device. A player disconnecting during bidding automatically pauses the game, and the host controls resuming it.

**1. Product scope**

The website has two connected parts: a builder for creating reusable auction templates, and a live multiplayer game using one of those templates. A template describes the theme and available options. A room is one independent playthrough with its own players, balances and purchases.

The first release is a social auction and final-build comparison. A dragon's firebreathing is descriptive; it does not yet have a damage statistic or combat simulation. Results do not automatically name the player who spent the most, bought the most, or kept the most money as the winner. Players can discuss and defend their creations. Formal voting or battle rules can be added later.

Support 2–5 players per room, counting the host and any administrators who join. Optimise the normal experience for 2–3 players while keeping 4–5 players fully supported. Enforce a minimum of 2 to start and a maximum of 5 player seats on the server. One person has one seat, balance and build regardless of their extra permissions. Reconnecting uses the existing seat; it never consumes an additional slot. One player running out of money must not end competition between the others.

**2. Builder**

| Field or control | Behaviour | Initial default |
| --- | --- | --- |
| Title | Required theme name | Build Your Perfect Dragon |
| Description | Optional introduction or scenario | Empty |
| Cover image | Upload, view, replace and remove | Optional |
| Starting currency | Equal budget for every player | 20 |
| Currency symbol | Display label for fictional currency | $ |
| Minimum opening bid | Lowest price an option can sell for | 1 |
| Minimum bid increase | Smallest permitted raise above the leading bid | 1 |
| Options | Add, edit, duplicate, remove and reorder | At least one required |
| Preview | Show how the current option appears during play | Available while editing |
| Save and portability | Save locally; export/import a complete template | Includes images |
| Host game | Create a lobby from the current valid template | No admin login required |

Each option has a required title, optional description and optional image. Starting currency, opening bid and bid increase are positive whole numbers. Reject a starting budget below the opening price. Explain validation errors beside the relevant fields.

Keep opening price and bid increase separate: an auction might open at $2 but permit raises of $1. Bids can exceed the minimum raise; they do not have to be exact multiples of the increment.

Options are independent additions. Buying three heads and firebreathing gives a player both. Mutually exclusive life choices, category limits and prerequisites need separate rules and are outside the first release; creators should write compatible options for now.

The initial play order follows the creator's order. Future option details remain hidden from game screens until revealed. The total number of options can be visible. A player who authored the template already knows its content; hidden room payloads cannot erase that prior knowledge. Host or administrator permissions do not add future-option previews to the live player controls.

**3. Saving and access**

| Player permissions | Allowed actions |
| --- | --- |
| Every player, including guests | Build local templates, save/export/import drafts, create or join a room, bid, give up on an option, inspect public game information and open the shared display |
| Host: one of the players | All normal player actions plus controls for their lobby and game; receives the same starting budget and competes under the same rules |
| Administrator: a player with account permissions | All normal player actions plus adding, updating, deleting, publishing and unpublishing permanent templates and their options; may also be the host |

Only permanent server template management requires administrator login. Hosting a game does not grant administrator permissions.

Model host status as a room permission attached to an existing player seat. Administrator access belongs to an authenticated account and grants template-management permissions only; it does not grant host control of another player's room or a bidding advantage. An administrator is not required to be online for a guest-hosted game, and can manage templates outside a live game. No separate non-playing host, moderator, spectator seat or spectator lobby exists.

Administrator changes include template settings, option text, order and images. Confirm deletion before removing a permanent template. Existing room snapshots remain playable after the source template is edited or deleted; retain referenced images until those rooms expire.

Local saves must clearly say “Saved to this browser”. Use IndexedDB for drafts containing images and offer a portable versioned JSON export with embedded image data. Local drafts do not automatically move between devices. During hosting, copy the chosen draft and images into temporary server room storage so other devices can see them.

Create each room from an immutable template snapshot. Later template edits must not change a live auction. Guests can host published templates without editing the originals. A published template's catalogue preview should show its cover and description, not disclose all future options.

**4. Joining and game flow**

1. A player selects a saved template or creates one in the builder, then creates a room and becomes its host.
2. The website creates the host's player seat and a lobby with a room code, join link and QR code.
3. Other players join with display names, up to 5 total including the host. A full room rejects a new seat with a clear message; simultaneous join requests cannot overfill it.
4. With 2–5 players ready, the host starts the game. New player joins then close. Late visitors see that the game has started; there is no spectator fallback. Existing players can still reconnect, including when all 5 seats are occupied.
5. The server reveals one option and starts its auction.
6. Players bid or give up on that option until the server determines the result.
7. A short result reveal shows the winner, price and updated balances.
8. The next option opens with fresh eligibility and concession status.
9. After all options are resolved, the game shows everyone's completed build and any unclaimed options.

There is no default bidding countdown. This supports conversation and bargaining while people play together. Result animations can use a short delay, with a host Next control as a fallback if presentation gets stuck.

**5. Auction rules**

- Every player starts with the configured budget. Only the winner pays, once, when the option is awarded. Losing bidders keep their money.
- The first bid must meet the opening price. Later bids must be at least the current bid plus the minimum increase, and cannot exceed the bidder's remaining balance.
- The leading bid is a binding commitment. The leader cannot withdraw it, give up on it, or raise their own bid.
- “Give Up This Option” removes a non-leading player from this option only. They may bid again on the next option. They cannot reverse that decision during the current auction.
- When no other non-conceding player can make a valid higher bid, the leader immediately wins at their accepted price.
- If no bid exists and only one eligible, non-conceding player remains, that player automatically buys the option at its opening price. Explain this consequence before play and beside Give Up.
- If no eligible player remains, the option is unclaimed. The host can also skip an unbid option if the group does not want it. An option with an accepted bid cannot be skipped to erase that commitment.
- The remaining budget never becomes negative. Every awarded option costs at least the opening price.
- “Bet All” bids the player's entire remaining balance, only if that is a legal bid. Put it well away from ordinary controls and require confirmation showing the exact amount.

Concessions and bids are applied in server order. For example, with two eligible players and no bids, the first accepted Give Up causes an automatic minimum-price purchase by the other player; two near-simultaneous taps do not create a special tie. To leave an unwanted unbid option unclaimed, the host's Skip action provides an explicit route.

**6. Running out of money and automatic awards**

Retain the earlier minimum-price rule: automatic awards are automatic purchases, not free leftovers. Check remaining balances independently at the start of every option.

| Situation at the start of an option | Result |
| --- | --- |
| Two or more players can afford the opening price | Run a normal auction |
| Exactly one player can afford the opening price | Award automatically to that player and deduct the opening price |
| Nobody can afford the opening price | Mark the option unclaimed |
| Nobody can afford any remaining option under the same fixed opening price | Finish early and list all remaining options as unclaimed |

Example: both players began with $20. After several purchases, Alex has $0 and Morgan has $3. The opening price is $1 and five options remain. Morgan receives the next three options for $1 each, ending on $0. The last two options remain unclaimed.

With three players on $0, $4 and $7, bidding continues between the two who still have money. There is no automatic split or free distribution of leftovers.

Show each automatic purchase and its cost clearly during the result reveals. Do not silently bundle several purchases into an unexplained balance change.

**7. Screens and presentation**

Use two deliberate responsive game layouts: a landscape website view and a portrait phone view. Design each around the available visible viewport so normal play does not require vertical or horizontal page scrolling. The landscape view is a complete playable interface, not just the shared display. Both layouts expose the same public game information and actions appropriate to that player.

| Layout | Arrangement |
| --- | --- |
| Landscape website | Compact status header; current option and image in the main area; player balances and build summaries alongside; bidding controls in a reserved action area |
| Portrait phone | Compact status header and up to 5 player/balance indicators; current option and image in the middle; current bid, own balance and primary bidding controls in a reserved bottom area |

Keep the current option, leading bid, own remaining money, all player balances, connection/pause status and primary actions visible during ordinary bidding. Compact the image and spacing before reducing text size or touch targets. Images must fit their allocated area without pushing controls offscreen. Fit all 5 player summaries using a compact grid or wrapped rows rather than a horizontally scrolling strip.

Use tabs, bounded dialogs and paged panels for acquired builds, bid history, longer option descriptions and final results. All information remains reachable without turning the game into a long page. On a phone, results can show one player's build at a time with player tabs and item pages. Keep current-auction status visible when inspecting secondary information, and provide an obvious return to bidding. Long titles and descriptions must have a readable full-text detail view rather than inaccessible clipping.

Keep Bid and Give Up within the visible action area. Put Bet All in a separate secondary action panel, away from the primary buttons, with its own confirmation. Host controls and appearance settings also open compact panels instead of adding a permanent toolbar that crowds the phone layout. Text-entry dialogs must remain usable with the on-screen keyboard open.

Size against the usable browser viewport, including mobile browser bars, screen cutouts and the home indicator; fullscreen is optional. Reflow when the window resizes or the device rotates. Do not achieve the fitted layout by disabling zoom, shrinking text to unreadable sizes or simply hiding overflowing controls. Use pagination and responsive composition to handle content growth. The no-page-scroll target applies to the lobby, auction, result reveals and final-results screens at normal supported viewport sizes. Builder and administrator editing forms may use normal scrolling.

Use a simple default visual style: uncluttered cards, restrained decoration, clear typography and obvious controls. Offer a small appearance panel with an immediate preview and Reset to Defaults. Include light/dark mode, an accent-colour picker, background-image upload/preview/removal, a glassy surface option and a small collection of theme presets. Suggested starter presets are Minimal, Glass, Neon and Paper; these are implementation defaults and can be renamed. Theme choices affect presentation only and do not change gameplay or the position of essential actions.

The glassy look uses translucent panels and background blur while keeping text and bid controls readable. Provide an opaque fallback when transparency is disabled or unsupported. Background images must have an appropriate overlay, and accent colours must not make labels unreadable. Keep presets and individual controls in one simple panel; users should not need to edit CSS. Respect reduced-motion preferences and offer a clear way to return to the default appearance.

Personal appearance preferences stay only in the current browser and survive refreshes there. They do not alter other players' screens, become administrator-wide defaults or sync between devices. Store any personal background image locally as well. The shared display uses that browser's own appearance settings. Keep personal visual preferences separate from template content such as a dragon's image, which must be available to participants during a live game.

| Screen | Main content |
| --- | --- |
| Home | Create, host a published template, join by code |
| Builder | Settings, options, images, preview and saving |
| Lobby | Join code/QR and player list; the host player also has Start controls |
| Player view | Current option, image, leading bid, legal bid controls, own balance and everyone's public information; host controls appear on the host player's screen |
| Shared display | Optional fullscreen read-only board for a TV or second screen; no player seat or independent spectator identity |
| Final results | Each build, item prices, total spent, remaining money and unclaimed options |
| Admin | Login and permanent template management |

The phone view must provide the same public information as the shared display: balances, purchased options, purchase prices, leading bidder and bid history. A TV is optional. Secondary information can use tabs and pages, while core bidding information stays on the main screen.

Any player can open the shared display from their game menu. It is a presentation surface for casting/mirroring or opening on another screen, not a spectator mode. It does not consume one of the 5 seats, receive money, own a build, bid, control the host or keep a disconnected player marked online. Use read-only display access without exposing player recovery codes or administrator sessions. Closing the display must not pause play. Native device-specific casting integrations are not required for the first release; provide a fullscreen browser display usable with normal screen sharing or mirroring.

The shared display reuses the landscape composition with player-specific controls removed and the available space given to public game information. It is not a third independent gameplay layout and must also fit the screen.

Keep 2–3 player layouts especially clear, and adapt balances, builds and results for 4–5 players without hiding anyone's public information. The host and administrator use the same bidding interface as the other players; management controls are secondary to play.

Use large clear bid buttons, a prominent remaining balance, readable option images, keyboard support, good contrast and reduced-motion support. Show disconnected, outbid, leading, conceded and insufficient-funds states in plain language. Avoid relying on colour alone.

**8. Reliability and host controls**

The server decides all bids, awards, prices and balances. A phone requests an action; it never supplies an authoritative winner or balance. Process commands sequentially per room and commit each accepted state change and purchase together in a database transaction before broadcasting it.

Attach a unique command ID and current auction ID to actions. Retries must return the original result rather than charge twice. Reject stale or invalid bids with the updated minimum. If two players submit the same bid, the first one accepted by the server stands; the second must meet the new minimum. No client timestamp determines the winner.

Use a secure player rejoin token, independent of the socket connection. Refreshing or switching networks restores the same seat and fetches a current server snapshot. Never replay an offline bid against a later option. Socket.IO reconnect support does not replace application state recovery.[3]

Rejoining restores the player's balance, purchased options, concession status and any accepted leading bid; hosts can recover their host role too. Automatic recovery in the same browser is required. A name and public room code must not be sufficient to take over an existing player. Also support recovery on another device using the room code plus a private recovery code. Guest drafts and appearance preferences still remain local even if a player moves their active seat to another device.

Show each recovery code privately to its owner with Copy and Replace Code actions. Codes are random, room-scoped and expire with the room; store only a verifier server-side and rate-limit recovery attempts. Never include codes in public game state, shared-screen QR links or logs. Successful recovery transfers control to the new device and revokes the old controlling session; obsolete devices cannot continue bidding. Handle that transfer atomically so closing the old connection does not falsely disconnect an already-recovered player. Recovering the host's own player seat also restores its server-recorded host permissions. Recovering another seat cannot grant host permissions, and a game recovery code never restores administrator account login; template management requires separate authentication. Replacing a recovery code invalidates the previous one.

Confirmed disconnect policy: automatically pause when an active player disconnects during bidding. Show who disconnected and preserve accepted bids, balances, purchases and concessions. While paused, reject bidding and Give Up actions, and do not perform ordinary settlement or advancement. The confirmed terminal End action described below is the sole exception. Shared-display disconnections do not pause play. The host is a player and their controlling-device disconnection also pauses gameplay, even if a shared display remains connected. The host explicitly resumes; a reconnect does not automatically restart bidding.

The host may resume despite an absent player, but resuming alone does not count as that player's Give Up or erase an accepted bid. Do not repeatedly pause for the same unresolved disconnection after an explicit host resume; a new disconnection is a new pause event. If someone has left permanently, the host can separately sit them out for the rest of the game; their existing leading bid still stands and previously purchased options remain theirs. Require confirmation and announce this action to the room. The host recovers through their own player seat; if they do not return, leave the room paused until expiry. Administrator status alone does not bypass this pause or transfer host control.

Persist active room snapshots and the financial ledger. Following a server restart, restore rooms paused and let the host resume. Do not re-run already settled purchases. Proposed room expiry is 24 hours of inactivity, extended by connected participants; clean up temporary assets when the room expires. Permanent templates remain until an administrator removes them.

Host controls are Start, Pause/Resume, Skip Unbid Option, Next after a result, Sit Out Disconnected Player, End Game and Play Again. Ending early preserves current purchases and labels the result incomplete. For implementation, a confirmed End also settles any current binding leading bid exactly once at its accepted price before ending; later options are unplayed/unclaimed. This deliberate terminal action is allowed while paused, unlike ordinary bidding or advancement. Hosts cannot arbitrarily choose winners or edit money during play.

**9. GitHub project and Coolify deployment**

Recommended initial structure:

| Component | Choice and purpose |
| --- | --- |
| Interface | React, Vite and TypeScript for builder, phone and shared-display screens |
| Server | Node.js, Express and Socket.IO for HTTP and live room updates |
| Game engine | Pure TypeScript module, independent of UI and networking |
| Shared definitions | Validated schemas and common types |
| Persistence | SQLite for templates, room snapshots and purchases; image files under the data directory |
| Deployment | One Docker application, one server process, one persistent data mount |

Keep the client, server, shared definitions, engine, migrations, Dockerfile, tests and deployment README in one GitHub repository. Separate deployable game data from source code: no uploaded images, live databases, player tokens or secrets in Git.

Coolify supports building a Dockerfile from a Git repository.[1] Connect the repository, select the Dockerfile build, configure the application's domain and HTTPS, and route traffic to the app's internal port, proposed as 3000. Serve the compiled frontend, API and Socket.IO endpoint from the same origin.

Configure PORT=3000 and DATA_DIR=/data. Mount a persistent server directory or Docker volume at /data before first use. A possible host path is /opt/appdata/bid-and-build; this is a proposal, not an existing configuration. Store the SQLite database and persistent images beneath that mount. Coolify's persistent storage keeps these files outside replaceable containers.[2]

Include a health endpoint, clean shutdown, schema migrations, a documented admin bootstrap process, upload size/type limits and server-side permission checks. Store secret values in deployment configuration. Use one active application process for this first design; avoid overlapping deployments that independently manage the same rooms. Deploy between games, stop the old process cleanly, and resume restored rooms after restart. Preview deployments need separate data.

Document a consistent SQLite backup procedure alongside image backups and test a restore. Persistent storage alone is not a backup.[2]

**10. Delivery milestones and acceptance**

| Milestone | Demonstrable result |
| --- | --- |
| Foundation | App runs locally and from Docker, with health endpoint and persistent data path |
| Auction engine | Tested bidding, concessions, purchases, automatic awards and unclaimed options |
| Builder | Create a game with images; save, refresh, export and re-import successfully |
| Multiplayer | Rooms of 2, 3, 4 and 5 players, including the host, see the same authoritative state |
| Presentation | Complete phone, shared-display and final-results views |
| Admin and deployment | Permanent templates protected; guest hosting works; Coolify deployment documented and verified |

The first release is complete when a player can build a dragon game, host it while participating, invite 1–4 other players, finish an auction, inspect all final builds, and play again with fresh balances. Verify games with 2, 3, 4 and 5 total players, rejection of a sixth seat, the 2-player start minimum, closed late joins, and recovery into an existing seat in a full room. Verify zero balances, insufficient raises, all-in confirmation, automatic purchases stopping at zero, two near-simultaneous bids, duplicate commands, reconnects, server restart, and template edits during a live game. Check that future options are absent from public payloads and that database/images survive a redeployment.

Also verify that appearance changes survive a browser refresh without changing another device, guest designs remain local until hosted/exported, private-code recovery preserves a seat while revoking old control, invalid/replaced recovery codes fail, and disconnections pause bidding until the host resumes. Check recovery of the host's seat restores only that seat's host permissions without granting administrator login. Confirm administrator accounts use ordinary player budgets and cannot control another host's room. Ensure the shared display never creates a seat, supplies player presence or interrupts the game when disconnected.

Visually verify the landscape and portrait game layouts with 2, 3 and 5 players, long names/titles, background images and each theme. Initial viewport targets are 360×640 and 390×844 portrait, plus 1280×720 and 1440×900 landscape, measured as browser content areas. Check that primary controls remain visible, the game page does not overflow horizontally or vertically at these sizes, secondary content is fully reachable through tabs/pages, and browser bars or the on-screen keyboard do not obscure required actions. Include a zoom/accessibility check so fitting the screen does not depend on disabling user scaling.

Later additions can include player voting, sound effects, random option order, optional bidding timers, category limits, trades and explicit battle rules. Each changes the experience and should be specified separately.

**11. Confirmed choices for Codex instructions**

1. Personal appearance controls: light/dark mode, accent colour, a background image, a glassy look and additional theme presets. All selections and personal images remain local to that browser.
2. Reconnection: automatic recovery in the same browser plus a private recovery code for moving an existing seat to another device. A public name or room code cannot claim that seat.
3. Disconnection: automatically pause bidding and let the host resume. Preserve accepted commitments and current state. Never silently treat a disconnect as Give Up.
4. Players and permissions: 2–5 players total, optimised for 2–3. The host is always a player; administrator account permissions can belong to any participating player, including the host. Everyone has one seat and the same bidding rules. There is no spectator role, and new joins close when play starts.
5. Shared screen: optional read-only presentation for a TV or second screen, available from a player's game menu. It uses no player slot and has no bidding, host or administrator powers.
6. Viewpoints: a landscape website layout and a portrait phone layout, each designed to fit the visible screen without scrolling the game page. Use tabs and pages for extra detail; keep bidding controls visible. The optional cast/display surface reuses the landscape layout.

No further product questions are required before preparing staged Codex instructions. Other operational settings in this draft remain documented implementation defaults rather than blockers.

Local-only guest saving means no permanent server template is created for that guest. Hosting still sends a temporary room copy of the game and its content images to the server so participants can play and reconnect. Delete that room copy and its temporary assets when the room expires. Personal appearance settings are not included in this transfer.

Technical references, checked 22 October 2026:

1. [Coolify: Dockerfile builds](https://coolify.io/docs/applications/builds/dockerfile)
2. [Coolify: Persistent storage overview](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview)
3. [Socket.IO: Handling disconnections](https://socket.io/docs/v4/tutorial/handling-disconnections)
