# Compact game screens and build comparison (Milestone 10)

The two compositions share authoritative public snapshots and existing auction controls. Landscape puts a bounded current auction and bidding controls alongside every player's acquired collection, in stable seat order. Portrait keeps up to five balances, the current option/high bid and primary controls visible around a persistent Your build collection. Compare builds opens everyone's public collections in one surface with current status and a clear return. Milestone 10 deliberately replaces the older build/result player selectors and item pagers.

The fitted board replaces the site's normal header/footer on room and display routes. Builder/admin forms still scroll normally. `100dvh` and safe-area insets reserve usable space. Images use `object-fit: contain`. Relative game sizing/type lets increased default text grow the layout; action buttons can stack when they need more width. At very short landscape sizes, text enlargement or accessibility zoom, the document may scroll so controls remain reachable. Zoom remains enabled; actual device zoom, browser bars and keyboards still need manual review.

## Information and actions

- **Option** shows the current option and contained image. Selecting its title opens full details. Selecting the game heading opens the complete game introduction and auction settings.
- **Details** measures text in its actual font/available region and pages it. Long titles, long words and 4,000-character descriptions stay accessible.
- **Collections / Results** shows all acquired items with small contained thumbnails (a star fallback when absent/unavailable), wrapping names and paid prices. Every player has a name, balance and acquired/spent total. Final results make comparison the main surface, with desktop columns or readable phone sections. Large phone collections may span both columns. Empty builds stay explicit; unclaimed/unplayed items are separate. Unrevealed future options remain counts only, including incomplete results. No scored winner is awarded.
- **Overflow** uses one bounded vertical area per collection/comparison surface, with sticky player headings. There are no item carousels, hidden “more” items, nested collection scrollers or horizontal scrolling. Main actions stay outside that area. Long names remain fully wrapped; exceptionally large collections intentionally require scrolling within the collection. Ordinary twelve-option sample results are a specific fit target for 2–3 players, including uneven ownership.
- **History** opens a dialog paging all public bids; **Details** opens the current option or game introduction. Native dialogs give long information its own readable space, close with Escape and return focus to the opener. Selecting any portrait balance card opens the same all-player comparison.
- **Bid** offers the server's current minimum. **Give Up** remains separate. **More** opens custom bid entry; its footer keeps Confirm/Cancel visible in the visual viewport. **Bet All…** has a separate exact-amount confirmation and Cancel.
- **Game menu** holds host Pause/Resume/Next/Skip/End/Play Again, invite code/link/QR and shared display. Start is also available in the lobby. End explains the binding bid it will settle. Resume with absent players requires acknowledgement that absence is not concession.

Collection items are ordinary keyboard-operable buttons. Native dialogs trap focus, close with Escape and restore focus to their opener, including details opened from comparison. Status announcements describe connection, own bidding state and settlements without narrating every balance card. Leading, outbid, conceded, insufficient funds, paused, disconnected, empty and unclaimed states use text as well as colour. A settled purchase appears once from the purchase ledger with a brief highlight; reduced motion uses a static border.

Bid and host confirmations remain scoped to run/auction/phase; an old custom bid dialog cannot silently bid on a later option. Read-only comparison/details remain open through settlement and ordinary advancement, with current comparison status updated from snapshots. A new run resets the board. Command receipts and controller handling remain unchanged. Milestone 6's private recovery-code panel, separate recovery form, named absence details and confirmed Sit Out remain; see `RECOVERY.md`. Auction status opens connection/absence details. Private codes never appear in the display.

## Read-only display capability

Any authenticated player can request `POST /api/rooms/:code/display`. The server returns a separate 256-bit display capability, derived using domain-separated HMAC-SHA256 with `SESSION_SECRET` and the room's unique game ID. It is unrelated to all player tokens, does not identify a player and cannot restore a seat or host/admin permission. Reissuing the link for a live room returns the same capability; expiry/deletion invalidates it, and a reused public room code cannot inherit it. Rotating the server secret also invalidates display links. Keep this secret stable across normal restarts.

The link is `/display/CODE#access=CAPABILITY`. Only the display capability appears in the fragment, never a player credential. The fragment does not reach HTTP logs; the display saves it in that tab's sessionStorage and immediately removes it from the visible URL/history entry. It never reads the player credential store. A link holder can read public game information until expiry, so share it with intended viewers. There is no recovery code or administrator data in the board.

Display sockets authenticate with `{ code, displayToken }`, receive the **same** `RoomService.snapshot` projection and never attach a player/controller or a disconnect hook. Display presence neither occupies a seat nor keeps a player online or a temporary room alive. Socket commands and receipt reads are denied. HTTP writes with Display authorization are denied, and the capability cannot authenticate to player snapshot/takeover routes. Protected display images use a `Display` Authorization header and the same reveal check; future assets remain inaccessible even if their real opaque ID is guessed. No media URL includes credentials.

`GET /api/rooms/:code/display` and `/display/media/:assetId` are the authenticated display read endpoints. The server sends `no-store`, `nosniff` and no-referrer policy; images retain their restrictive CSP. Ordinary room URLs without a capability show instructions, not a spectator join flow. Fullscreen uses the browser API. Cast/mirror with ordinary browser or device screen-sharing controls; there is no native casting integration.

## Repeatable checks

```powershell
# On this prepared Windows machine; use a normal Node 24 install elsewhere.
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
npm.cmd run check
npm.cmd test
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm.cmd run test:e2e
```

`test:e2e` builds production assets and runs four sequential Playwright shards, one worker each. Each shard starts its own real isolated HTTP/Socket.IO server on **127.0.0.1:3197**, random temporary SQLite directory and secret. This keeps unrelated scenarios from spending the same local IP's real room-creation rate-limit budget; application limits are unchanged. Focused arguments (for example `npm.cmd run test:e2e -- tests/e2e/collections.spec.ts`) run directly. The suite never reuses a user server or database. Graceful shutdown removes only the verified temporary directory; forced interruption can leave it behind. Reveals last 60 seconds in this test server for deterministic inspection; normal play remains 1.8 seconds. Fixtures are hosted through the real API, never injected room state.

On another platform, omit `CHROME_PATH` and install Playwright Chromium once with `npx playwright install chromium` (Linux may also need `npx playwright install --with-deps chromium`). No browser download is required to use an installed compatible Chromium path. Browser binaries and Playwright are development tools, not production dependencies.

`tests/e2e/lan.spec.ts` additionally uses its own real server on **127.0.0.1:3198** and temporary database. Chromium maps `bid-build-lan.test` to loopback for `http://bid-build-lan.test:3198`, giving a real insecure browser context without mocking crypto or relaxing origin checks. These scenarios verify phone joining/bidding/refresh, backend restart and explicit Resume, private-code control transfer, and lost create/join response retries with unchanged SHA-256 fingerprints and no duplicate seats. Run just these checks with `npm.cmd run test:e2e -- tests/e2e/lan.spec.ts`. This does not verify physical Wi-Fi/firewall/device behaviour.

Playwright uses separate player/display contexts. Collection stress tests also use real independent Socket.IO opponents alongside a browser-controlled host, never fabricated snapshots. Coverage includes 2/3/5-player layouts at all four target sizes; full twelve-option sample games; empty/uneven builds; long collections, titles and names; missing images; bounded overflow and last-item access; complete/incomplete comparisons; keyboard focus; description/history pages; maximum currency; and actual control bounds/clickability. Existing bid confirmation, QR/builder hosting, refresh/pause/resume, receipt recovery, takeover and privacy checks remain. Display tests cover collections, forbidden actions, future content/media, fullscreen, refresh and no player-presence effect.

The merged HTML report is in ignored `.cache/playwright/report/`. Full runs retain per-shard screenshots/traces under unique `.cache/playwright/run-*/` directories; focused runs use `.cache/playwright/results/`. Traces contain test credentials and must not be published as real game logs. `node scripts/check-rooms-browser.mjs` delegates to this suite. The separate builder regression remains `node scripts/check-builder-browser.mjs` against the development server.

Manual checks still required: actual phone browser bars, keyboard dismissal/panning, safe-area cutouts, touch, screen readers, Safari/Firefox and real TV mirroring/casting. Docker/Coolify remains unverified. Milestone 6 recovery browser coverage is described in `RECOVERY.md` and the current results are recorded in PROGRESS.md.

## Milestone 8 appearance checks

The shared appearance panel and semantic colour tokens now cover player screens, dialogs and the display. Theme changes preserve game state and control positions. Automated appearance scenarios exercise every preset with custom accent/background/glass for 2/3/5 players across the four target viewports, plus pause, confirmation dialogs, keyboard space, results, recovery and display isolation. See [APPEARANCE.md](APPEARANCE.md) and PROGRESS.md for scope, real results and manual device limitations.
