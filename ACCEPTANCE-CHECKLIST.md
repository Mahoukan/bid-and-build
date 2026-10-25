# Manual acceptance checks

Run these after the relevant milestones and again before deployment. Record failures or untested items in PROGRESS.md. Use separate browser profiles for independent players. Do not mark a check done merely because Codex wrote a test for it.

Milestone 9 source/automated evidence and outstanding device/deployment checks are recorded in [docs/ACCEPTANCE-AUDIT.md](docs/ACCEPTANCE-AUDIT.md). These boxes remain the owner's manual review checklist; automated coverage is not a claim of physical-device or Coolify verification.

**Builder and storage**

- [ ] Import samples/dragon-game.json and edit every setting.
- [ ] Add, duplicate, remove and reorder options; names/IDs/order stay correct.
- [ ] Upload a cover and option image; save locally, refresh, export and re-import; both images survive.
- [ ] A second browser has no automatic copy of those local drafts.
- [ ] Invalid budgets/increments, malformed JSON and unsupported images show useful errors.
- [ ] A guest can host a local draft without administrator login.
- [ ] Editing/autosaving a local draft does not send it or personal backgrounds to the server.

**Rooms and permissions**

- [ ] Creating a room also creates the host's player seat with the normal budget.
- [ ] Start is unavailable with one player; games work with 2, 3, 4 and 5 total players.
- [ ] A sixth new player is rejected, including when two people race for the final slot.
- [ ] New joins after Start are rejected; there is no spectator option.
- [ ] Refreshing/recovering an existing player works in a full room without adding a seat.
- [ ] Admin players have normal money and cannot control another player's hosted room.
- [ ] An ordinary player cannot send host/admin actions by bypassing UI buttons.

**Bidding**

- [ ] Only the winner pays. Losing bids do not reduce balances.
- [ ] Opening price, minimum increase and a legal larger custom bid all work.
- [ ] Negative, fractional, over-budget and stale bids are rejected.
- [ ] A leader cannot withdraw, give up or raise their own bid.
- [ ] Give Up affects only that option; next option restores eligibility.
- [ ] With no bid, the final eligible player automatically pays the opening price.
- [ ] Host Skip only works before a bid; unwanted options can be left unclaimed this way.
- [ ] One player on $0 does not stop two other funded players bidding.
- [ ] If only one player can buy, each automatic award deducts the opening price and stops when funds run out.
- [ ] With $0 and $3 and five $1 options remaining, exactly three are bought and two unclaimed. This can be verified through an isolated engine test fixture.
- [ ] Bet All is away from ordinary actions, shows the amount and requires confirmation.
- [ ] Two near-simultaneous identical bids do not produce two winners or charges.
- [ ] Double-clicks/retries do not repeat deductions.
- [ ] Confirmed End with a live leading bid resolves that commitment once and labels the results incomplete.
- [ ] Play Again resets game money/builds and requires a new Start; old commands cannot affect it.

**Recovery and pause**

- [ ] A refresh retains name, seat, money, purchases, concessions and any leading bid.
- [ ] A disconnected player pauses bidding; controls clearly show the pause.
- [ ] Reconnecting does not automatically resume; the host resumes.
- [ ] A private recovery code restores a seat on another device; the old controller loses access.
- [ ] Wrong, replaced or expired recovery codes fail; codes are not shown on public screens or shared links.
- [ ] Recovering the host restores that seat's host permission without granting admin login.
- [ ] A missing host leaves the room paused until recovery; another admin cannot bypass it.
- [ ] Explicit host resume with an absent player does not erase a binding bid or repeatedly pause for the same absence.
- [ ] Stop/restart the server after an award; recover paused with the same money and exactly one purchase.
- [ ] Guest designs and appearance settings remain local when a seat moves to another device.

**Layout and appearance**

- [ ] Landscape website is fully playable, including host controls.
- [ ] Portrait phone is fully playable, including custom bidding and the on-screen keyboard.
- [ ] At 360×640, 390×844, 1280×720 and 1440×900, normal game screens need no page scrolling.
- [ ] With five players and long labels, all balances and primary bid controls remain visible and usable.
- [ ] Landscape shows every player's collection together in stable order; portrait has persistent Your build and one Compare builds surface with current status and a clear return.
- [ ] Results show every player, every acquired option, paid prices, total spent and balance together; no player tabs, item pages or scored winner.
- [ ] Acquired names wrap without clipping; missing images have a fallback; full details open by tap/click/keyboard and focus returns on close.
- [ ] Ordinary 12-option sample results fit for 2–3 players, including uneven ownership. Longer collections use one bounded vertical scroll surface; the last item is reachable while primary controls remain fitted. No nested/horizontal scrolling.
- [ ] Empty builds, 5-player comparisons and unclaimed/unplayed items remain understandable without leaking unrevealed details. History and descriptions remain fully reachable through dialogs/pages.
- [ ] Light/dark mode, accents, local backgrounds, glass and every preset work without breaking layout or contrast.
- [ ] Appearance survives refresh locally and does not change another browser's view.
- [ ] Reset appearance leaves drafts and player identity intact.
- [ ] Keyboard focus, zoom, reduced motion and readable glass/opaque fallback work.

**Shared screen and admin**

- [ ] Any player can open the optional shared screen; it takes no slot and cannot bid.
- [ ] Closing/reloading the display does not pause the game or impersonate a player's presence.
- [ ] Future options, private codes and admin controls are absent from public/display payloads and asset access.
- [ ] Administrator can add, edit, delete, publish and unpublish templates/options/images.
- [ ] A guest cannot permanently save/delete server templates through direct requests.
- [ ] An active room survives edits/deletion of its source template and retains working images.

**Deployment**

- [ ] Typecheck/lint, meaningful engine/integration tests, build and representative browser tests pass.
- [ ] Docker image builds and its production admin commands work without dev dependencies.
- [ ] Coolify uses one instance, internal port 3000, correct origin, persistent /data and stop-before-start deployments.
- [ ] Domain HTTPS, join links and live socket updates work on actual phones.
- [ ] A redeploy preserves templates, images, sessions/room recovery and the purchase ledger.
- [ ] Backup plus restore has been verified into separate storage.
- [ ] No environment secrets, live databases, personal backgrounds or uploaded user assets were committed.
