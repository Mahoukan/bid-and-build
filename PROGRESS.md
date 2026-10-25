# Build progress

Milestones 1–10 are implemented. Stopped at the **Milestone 10 review checkpoint on 25 October 2026**, including the focused LAN HTTP joining correction below. Local checks passed; M9 still awaits external deployment checks. Existing uncommitted work and the owner's M1 commit `0eb1cb2` are preserved; no commit, push or deployment has been performed.

| Milestone | Status | Verification / remaining work |
| --- | --- | --- |
| 1. Foundation and local runtime | Complete; owner proceeded to Milestone 2 | Foundation checks passed; committed as `0eb1cb2`. Docker execution remains unverified. |
| 2. Auction engine | Complete; owner proceeded to Milestone 3 | Pure engine, command/event schemas and snapshot invariants preserved. All 90 engine tests still pass, including 80 generated full-game traces. |
| 3. Local builder and template format | Complete; owner proceeded to Milestone 4 | Shared portable schema, real IndexedDB drafts, images, builder and JSON import/export. Original checks passed; full isolated Chromium builder regression passed again after Milestone 4. |
| 4. Multiplayer rooms and persistence | Complete; owner proceeded to Milestone 5 | Guest hosting, 2–5 real seats, ordered transactional commands/ledger/receipts, controller handling, pause/resume, restart restoration and protected media. Existing behavior retained in Milestone 5 checks. |
| 5. Finished player screens and shared display | Complete; owner proceeded to Milestone 6 | Fitted phone/landscape boards, paged public content/results, bid/host dialogs, invite QR and read-only display. All eight original browser scenarios passed again during Milestone 6. |
| 6. Recovery and disconnect handling | Complete; owner proceeded to Milestone 7 | Private codes/replacement, atomic handoff, lost-response retries, legacy-seat upgrade, automatic pause/resync, confirmed Sit Out and restart/expiry. Check/build and 207 unit/integration tests passed; full 11-scenario browser suite passed. See final verification below. |
| 7. Admin template management | Complete; owner proceeded to Milestone 8 | Private compiled CLI, durable administrator sessions, protected CRUD/publication, shared editor, safe public catalogue, guest hosting and independent room assets. Check/build, 218 tests, 13 browser scenarios, final two-scenario admin rerun and guest-builder regression passed. |
| 8. Local themes and viewport polish | Complete; owner proceeded to Milestone 9 | Local appearance panel/presets, contrast-safe tokens, separate image storage, reset/privacy/failure handling, fitted gameplay and display/recovery independence. Original checks passed; all seven appearance scenarios passed again in the full M9 suite. |
| 9. Docker, CI and deployment handoff | Implemented; awaiting owner review and external deployment checks | Docker packaging, Linux CI, graceful drain, safe proxy configuration, backup/restore CLI, production/container smoke runners, full sample games and reconciled handoff. Clean install, check/build, 230 tests, all 22 browser scenarios plus a final two-scenario rerun, and production-only restart/restore passed. Docker daemon unavailable; hosted Linux CI/Coolify not run. |
| 10. Compact board and full-build comparison | Complete; awaiting owner review | Compact collections/reflow and LAN HTTP joining correction. Latest lint/typecheck/build, 230 tests and all 28 browser scenarios passed, including two new insecure-origin/restart/retry regressions. Physical devices and M9 deployment checks remain outstanding. |

Codex: update the appropriate row after each milestone. Record real commands and outcomes, important implementation decisions, the next task, and outstanding user checks below. A feature is not verified merely because its code was written.

Current milestone: **10 — review checkpoint. Stop here.** The M10 user request supersedes earlier acquired-build/result tabs and item pagers; historical M5/M8 notes below describe the old layout. No later milestone is authorised. Docker, hosted Linux CI, physical-device and Coolify verification remain outstanding from M9. Do not commit, publish or deploy without explicit instruction.

Current launch commands (Windows PowerShell from the repository root):

```powershell
# This machine's system Node is 25.5.0. Select the local verified Node 24:
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
npm.cmd run dev
```

Launch URL: **http://localhost:5173**. Open Appearance in the site header or Game menu; the shared display has its own button. Builder: **http://localhost:5173/builder**; admin: **http://localhost:5173/admin**; catalogue: **http://localhost:5173/templates**. Backend health: **http://localhost:3000/health**. The development server is not currently running; launch it with the command above. M10 browser checks serve built assets on isolated temporary servers at port 3197. On another machine, select Node 24 LTS and npm >=11.19.1 <12, then run `npm ci` and `npm run setup` first. Appearance details are in `docs/APPEARANCE.md`; private admin setup is in `docs/ADMIN.md`.

Current ports: frontend development 5173; server/production 3000. `npm start` serves the built client, API and sockets in one Node process. Root `.env` supplies development settings; runtime environment overrides it.

Milestone 10 focused LAN joining correction (25 October 2026):

- Re-read project instructions, brief, prompts and progress; inspected current room request/connection code and installed tools. Reproduced the reported `Cannot read properties of undefined (reading 'digest')` in real Chromium at a non-localhost HTTP origin. Ordinary localhost tests had hidden the problem because localhost is considered a secure context.
- Cause: create/join/recovery requests calculated their persistent retry fingerprint using `crypto.subtle.digest`, which is unavailable on ordinary LAN HTTP. Replaced that call in `client/src/rooms/api.ts` with SHA-256 from exact `@noble/hashes` 2.4.0. Confirmed registry engine compatibility with Node 24 before installation; one runtime dependency added in the root package/lockfile. The UTF-8/JSON/lowercase-hex fingerprint remains identical. Secure random request keys, pending-request privacy, lost-response deduplication and all server origin/authentication checks remain intact.
- Added `tests/e2e/lan.spec.ts`: a real insecure HTTP hostname mapped to loopback only in Chromium, a separate server at port 3198 and a verified temporary SQLite directory. Tests assert that SubtleCrypto is actually absent; no crypto API is mocked or browser trust setting relaxed. Coverage includes phone joining/bidding/refresh, same-seat recovery, revoked old control, host permission preservation, restart with a binding bid, explicit Resume and exactly-once purchases. Lost create/join responses retry after refresh without duplicate rooms/seats; Unicode fingerprints match independent Node SHA-256.
- Investigated the supplied Vite errors: the watch restart temporarily removes the backend listener, so proxy requests can receive `ECONNREFUSED` before the next listening message. The real backend restart regression passes: actions disable, the same seats/bids return paused and purchases are not charged twice. No proxy error suppression or automatic Resume was added. Persistent refusals after startup would need backend/port investigation.
- Current ignored `.env` still specifies `http://localhost:5173`. For phone testing, set the matching LAN origin using the launch command below. No secret, data directory or permanent local configuration was changed. `ipconfig` found this PC's current active LAN address as **192.168.68.53**; this can change. Windows CIM network inspection was denied, so the ordinary read-only `ipconfig` command was used instead.

Checks actually run for this correction:

| Check | Result |
| --- | --- |
| Browser reproduction before the fix | Both new cases failed; the join page displayed the exact reported `digest` error before any join request was sent |
| `npm.cmd install --save-exact @noble/hashes@2.4.0` | Installed one package after registry engine/export inspection; Node 24.22.1 / npm 11.19.1 |
| Focused LAN browser scenarios | **2 passed** after the fix. Corrected test-only `route.fetch` destination resolution because Chromium's hostname mapping does not apply to Node; original Origin/body stayed intact |
| `npm.cmd run check` | ESLint and both TypeScript projects passed |
| `npm.cmd test` | **230 tests passed in 10 files** |
| `npm.cmd run build` | Server and production client builds passed |
| `npm.cmd run test:e2e` | **All 28 scenarios passed**, four sequential shards of seven, including both new LAN cases and existing gameplay/appearance/admin/collection/full-sample coverage |
| `npm.cmd audit --json` | One existing high-severity transitive `body-parser` 2.3.0 advisory, GHSA-27r3-jxmh-p828; unrelated to the new package. Recorded in `docs/DEPENDENCIES.md` for separate maintenance; not reported as a clean audit |
| `git -c core.autocrlf=false diff --check` / listener check | No whitespace errors; test servers stopped and no development listener remains on 3000/5173 |

Latest full browser artifacts: `.cache/playwright/report/` and `.cache/playwright/run-OMvoXj/`. Only isolated temporary test databases were used. The prior M10 results below remain historical evidence. Changed for this correction: `client/src/rooms/api.ts`, `package.json`, `package-lock.json`, `tests/e2e/lan.spec.ts`, `README.md`, `docs/DEPENDENCIES.md`, `docs/GAME-SCREENS.md`, and this progress file. No engine/server/schema changes or later milestone work.

Phone review launch (stop an existing development command first; these overrides apply only to this PowerShell session):

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
$env:APP_ORIGIN = 'http://192.168.68.53:5173'
npm.cmd run dev
```

Launch **http://192.168.68.53:5173** on both PC and phone on the same LAN; reload the phone page to load the corrected client. If the IP changes, update both URL and `APP_ORIGIN`. Host/join with two browsers, bid, refresh the phone, confirm the same seat returns paused, then Resume as host. A server watch restart should also reconnect paused with the bid/purchases intact. Close this terminal or remove the `APP_ORIGIN` environment override when returning to the localhost configuration. Actual phone/Wi-Fi/firewall/browser behaviour still needs this manual check; browser emulation does not verify the device. M9 Docker/Linux CI/Coolify checks remain outstanding. Suggested commit: **`Fix LAN HTTP joining and retry fingerprints`**. Stop at the M10 checkpoint.

Milestone 10 implementation and review (25 October 2026):

- Preserved existing M1–M9 work, real data/secrets and the owner commit. Read the supplied M10 request and project instructions, inspected the prior interface/screenshots at all four target sizes, and used portable Node 24.22.1/npm 11.19.1. No engine/server/schema/dependency changes, reset, commit, push or deployment. The Sites skill was used only for its existing-checkout local workflow; no external site was registered or published.
- Replaced build/result player selectors and item carousels with a reusable revealed-option collection: contained thumbnails or a missing-image fallback, fully wrapping names, paid prices and keyboard/tap details. Desktop shows everyone in stable seat order beside a compact auction and controls. Portrait has persistent Your build plus one all-player Compare builds dialog with current status and a clear return.
- Final results use the main board for everyone's complete collections, acquired/spent totals and remaining balances. Phone sections use two columns, with wider sections for large/odd collections; desktop summary headers align. Unclaimed/unplayed options remain distinct, with unrevealed items shown only as counts. No scoring or winner is introduced.
- Collections have one bounded vertical scroll surface and sticky player summaries. Primary controls remain outside scrolling collections. Acquired names are never clamped or ellipsised. Ordinary 12-option sample results, including all items owned by one player, have specific no-collection-scroll checks for 2–3 players. A 32-item maximum-title-length fixture exercises intentional overflow. Item/primary targets retain at least 44px at default text size.
- Kept protected asset access, authoritative ledger rendering and a brief reduced-motion-aware purchase highlight. Read-only comparison/details can stay open across settlement; a new run resets them. Bid/host confirmations retain run/auction/phase keys, preventing stale confirmation reuse. Shared display uses the same collections without player actions. Appearance uses existing tokens and glass/opaque fallbacks.
- Converted game sizing/type to relative units and retained accessibility reflow rather than clipping enlarged content. Normal targets stay fitted; enlarged text/zoom may scroll the document. Phone controls reflow when text needs more width. Physical-device text scaling still requires review.
- Updated AGENTS.md, PROJECT_BRIEF.md, ACCEPTANCE-CHECKLIST.md and CODEX_PROMPTS.md to make M10 the current collection requirement and mark conflicting M5/M8 instructions superseded. Historical progress/results remain intact. Updated README and game/appearance/audit notes.
- Adapted only superseded browser selectors/pager expectations while retaining auction, recovery, privacy, admin and appearance checks. Added three real-server collection scenarios and the full sample with three independent browsers. The expanded suite hit the unchanged production room-creation limit when unrelated tests shared one local IP. The npm e2e runner now uses four sequential isolated shards with fresh temporary servers/databases and a merged report; no server limit or assertion was weakened.

M10 checks actually run:

| Check | Result |
| --- | --- |
| Tool/worktree and baseline UI inspection | Node 24.22.1/npm 11.19.1 and Git 2.52.0 confirmed; existing work preserved; prior board/screenshots inspected at all four sizes |
| `npm.cmd run check` | Lint and both TypeScript projects passed |
| `npm.cmd test` | **230 tests passed in 10 files**, including engine, real sockets/persistence/recovery, authorisation/privacy, appearance and operations |
| `npm.cmd run build` (also part of e2e) | Server and production client builds passed |
| Focused responsive/sample checks | Seven fitted/long-content/full-sample scenarios passed after layout corrections |
| Focused collection checks | Three passed, including 2/3/5 seats, empty/uneven/long collections, sticky summaries, keyboard details/focus return, same-open comparison updating on settlement, missing images, 200% root text and read-only display |
| `npm.cmd run test:e2e` | **All 26 scenarios passed**, no skipped/flaky tests, across four isolated sequential shards (7 + 7 + 6 + 6), with a merged HTML report. Includes admin, gameplay/recovery/display, themes, collections and complete sample games |
| Final affected-layout rerun | **All 14 selected scenarios passed** after the last enlarged-text overlap fix: 2/3/5-player fitted/theme/collection/sample cases, long content, display/recovery and the new non-overlap assertion. Used the Node Playwright CLI directly with the regex below; completion was confirmed from the saved passed run status and final screenshots after the chat resumed |
| Visual inspection | Rendered 360×640, 390×844, 1280×720 and 1440×900 screenshots inspected, including all-player/uneven sample results, long collections, light Glass/background and dark Neon/background. Final normal and 200% root-text screenshots inspected after the overlap correction |
| `git -c core.autocrlf=false diff --check` | Passed; no whitespace errors |

Verification corrections: fixed resize-test synchronisation; compacted three-player and highly uneven sample grids without shrinking touch targets; corrected a phone missing-image placeholder overflowing its allocated art area; corrected an overlong test-only player name; placed prices beside names to avoid unnecessarily tall cards. Screenshot review caught a 200%-text action/collection overlap after the full suite; added a failing non-overlap assertion and corrected action alignment, then all 14 affected scenarios passed. The initial single-server full run passed 24/26 and hit the real room-creation limit twice; isolated shards resolved that test-environment contention without weakening application limits. Two filtered Windows `.cmd` invocations misinterpreted regex pipes/spaces; direct Node invocation below ran the intended checks. No unresolved local application test failure remains. Original auction/identity rules are intact.

Final focused command (after selecting the Node 24 toolchain and setting `CHROME_PATH` to installed Chrome):

```powershell
node node_modules/@playwright/test/cli.js test --grep "M10|players:|long.content|every.preset|full.sample|shared.display.and.recovered" --reporter=list
```

Artifacts: the complete 26-result merged report is `.cache/playwright/report/`, with per-shard screenshots/blobs in `.cache/playwright/run-XLGPwr/`. The final 14-scenario rerun used the list reporter to preserve that full report; its screenshots and passed `.last-run.json` are in `.cache/playwright/results/`. Baseline comparison screenshots remain in `.cache/m10-before/`. All are ignored local artifacts containing test-only rooms. Test servers have stopped; no verification room was written to the owner's data directory.

M10 changed files (relative to the pre-M10 working tree, not the older Git commit):

- Client: `client/src/rooms/Collections.tsx` (new), `GameBoard.tsx`, `PublicPanels.tsx`, `ui.tsx`, `room.css`, `Room.tsx`, `Display.tsx`; `client/src/appearance/appearance.css`.
- Browser checks: `tests/e2e/board-assertions.ts` and `collections.spec.ts` (new), `game.spec.ts`, `appearance.spec.ts`, `release.spec.ts`; `scripts/e2e.mjs` (new) and `package.json` script only. No package/lockfile resolution changed.
- Documents: `AGENTS.md`, `PROJECT_BRIEF.md`, `CODEX_PROMPTS.md`, `ACCEPTANCE-CHECKLIST.md`, `PROGRESS.md`, `README.md`, `docs/GAME-SCREENS.md`, `docs/APPEARANCE.md`, `docs/ACCEPTANCE-AUDIT.md`.

Still unverified: actual phone browser bars, safe-area cutouts, virtual keyboards, touch/OS text scaling, screen readers, Safari/Firefox and real TV mirroring. Browser emulation is not physical-device verification. M9 Docker daemon/Linux container/hosted CI/Coolify execution and production HTTPS/proxy/backup deployment rehearsal remain outstanding. No deployment check has been marked complete by this UI milestone.

Owner review: launch locally, open **http://localhost:5173/builder**, host the dragon starter and join using a separate browser profile. Buy several options, resize desktop/portrait, inspect Your build and Compare builds, open an item by keyboard/tap, and finish to compare everyone together. Try a long draft to check bounded scrolling, switch a light/dark/glass theme, and open the read-only display. Suggested commit after review: **`M10: compact game board and full-build comparison`**. Stop at the M10 checkpoint; no later milestone is authorised.

---

Milestone 9 implementation and review:

- Read all four project instruction/progress documents and ACCEPTANCE-CHECKLIST.md, inspected current source, tool versions and the worktree, then completed only M9. Preserved the owner's commit, existing M2–M8 source, real DATA_DIR, secret and identity. Used portable Node 24.22.1/npm 11.19.1; system Node 25/npm 11.8 remain unchanged. No new application package, lockfile resolution or schema migration. No subagents, publication or deployment.
- Reviewed every product requirement; evidence and manual gaps are mapped in `docs/ACCEPTANCE-AUDIT.md`. The original manual checklist remains unticked for the owner's device/deployment review. Existing engine, client, guest draft/theme and private-recovery behavior was preserved.
- Closed the shutdown gap for admitted asynchronous administrator login/image work after a client disconnects. A runtime admission gate stops new HTTP/socket work, room queues stop accepting commands, and tracked admin/room tasks drain before SQLite closes. Synchronous transactions commit/roll back before exit. Duplicate termination signals are guarded; emergency deadline is 25 seconds, paired with a documented 30-second container grace period. Interrupted games still recover paused without replaying settlement.
- Added `TRUST_PROXY`, empty by default, accepting only explicit proxy IPs/CIDRs. Untrusted forwarded client addresses remain ignored; no boolean/hop-count/all-addresses shortcut. Documentation requires the actual Coolify proxy network and restricted backend access, so IP limits can work per client instead of grouping the entire proxy.
- Added compiled `db:backup` and `db:restore` commands. SQLite's online backup captures WAL commits and content-image BLOBs consistently. Schema/history, integrity, foreign keys and SHA-256 are checked; restore validates the copied DB in a separate new directory. Both refuse existing destinations and never clear live data. A failed operation may retain a new incomplete directory. Private environment/secrets and local browser files are excluded. `docs/BACKUP-RESTORE.md` covers off-server retention, matching secrets, expiry, migration rollback and separate storage rehearsal.
- Finished the multi-stage Debian Node 24.22.1 image, explicitly pinning npm 11.19.1 for the allowScripts policy. Production-only dependencies, compiled server/client/shared/engine and all admin/migration/backup commands are included. Runtime uses UID/GID 1000:1000 with owned `/data`, direct Node PID 1, SIGTERM and readiness. The context allowlist additionally excludes private/generated files nested in source folders. No Windows node_modules is copied into the image.
- Added `.github/workflows/ci.yml`: Ubuntu 24.04 / Node 24.22.1, clean npm install, lint/typecheck, tests, build, real compiled production smoke, all Playwright scenarios, Docker build and disposable named-volume smoke. Actions versions follow current primary documentation; permissions are read-only, with no deployment secrets/push steps. YAML parsed locally using Playwright's existing bundled parser. Hosted execution remains pending publication.
- Added `test:production` / `test:docker` runners sharing one real HTTP/Socket.IO scenario. They provision only isolated fixtures through compiled private modules, verify native images/CLI guards/Secure cookies/session persistence, purchase once, replay the receipt, replace the process, recover a private seat, reject the old credential, back up and restart from a separate restore with one ledger entry. Docker uses only its unique labelled disposable volume and verifies clean SIGTERM exits. No public test endpoint or fixture enters the production image. Windows process termination proves crash recovery; Linux signal behavior remains pending CI/Docker.
- Added two complete UI scenarios importing the original twelve-option dragon sample, saving locally, creating the host seat, joining through independent contexts, bidding/conceding every option, inspecting results and playing again with fresh balances for 2 and 5 players. No fake room state or shortened sample.
- Production-only verification found an existing SPA routing problem when a checkout is under a hidden parent directory: absolute `sendFile` was denied as a dotfile path. Corrected it to serve `index.html` relative to the explicit client root, retaining dotfile denial. The runtime routing tests now use a hidden parent and the isolated production-only release passes.
- Updated README, `.env.example`, dependency notes and Coolify instructions with actual commands/paths, phone LAN workflow, runtime ownership, proxy trust, single replica, stop-before-start behavior, HTTPS, backup/restore and unverified platform checks. Official Coolify/Express/SQLite/Actions/Playwright sources were consulted; no remote application was changed.

Milestone 9 checks actually run (final application code unless noted):

| Command / check | Result |
| --- | --- |
| Tool/worktree inspection | Node 24.22.1/npm 11.19.1 selected; Git 2.52.0; existing work/data preserved |
| Isolated `npm.cmd ci --prefix ... --cache .cache/npm --no-audit` | **333 packages installed** from the unchanged lockfile in a fresh ignored directory, without replacing the working app's node_modules |
| Isolated `npm.cmd ci --omit=dev --prefix ... --offline --cache .cache/npm --no-audit` | **134 production packages installed**; TypeScript absent; compiled release copied into that test folder and exercised successfully |
| `npm.cmd run check` | Final ESLint and both strict TypeScript configurations passed |
| `npm.cmd test` | **230 tests passed in 10 files**, including new consistent backup/separate restore, corruption/overwrite protection and shutdown/aborted-client regressions; original engine/room/admin/template/appearance cases retained |
| `npm.cmd run build` | Final server/CLI and client production build passed; no build warnings |
| `npm.cmd run test:e2e` | **22 passed**, no skips/flaky/failures, in 270.6 seconds: 11 gameplay/recovery/display, 7 appearance, 2 admin and 2 new full-sample scenarios. Completed report/ZIP was inspected after the session interruption |
| `npm.cmd run test:e2e -- tests/e2e/release.spec.ts` | **2 passed again in 13.3 seconds** after the final SPA hidden-parent routing fix |
| `npm.cmd run test:production` and the same runner in the production-only test install | Passed real compiled routes, native image processing, compiled private admin command guards/modules, login/session persistence, purchase/restart/recovery, duplicate receipt and backup/restore with exactly one $3 ledger entry |
| Screenshot inspection | Five-player complete sample results at 1280×720 and five-player bidding at 360×640 inspected; balances, actions and paging remain visible/readable |
| Workflow / repository checks | CI YAML parsed and Linux target/read-only permission checked; `git diff --check` passed. Tracked-file/ignore review found no live secret/database/cache/tool tree committed; `.env.example` remains the intended tracked placeholder |
| Development launch | Existing `.env` preserved by setup; home/builder 200, direct 127.0.0.1:3000 and proxied /health ready at schema 4 after watcher settled |
| `docker version` (also outside sandbox) | Docker CLI 29.7.2 present; Linux daemon pipe `dockerDesktopLinuxEngine` unavailable. **No image build/container run/Linux success is claimed** |

Verification corrections: the first offline clean install lacked a cached tarball, so a new network-enabled isolated install was used and passed. An initial browser run stopped at Node's JSON import-attribute requirement; corrected the new test import, then all 22 passed. Type/lint issues in new backup/smoke code were corrected before final checks. The production-only run initially reproduced the hidden-parent SPA 404 described above; fixing application routing made the same check pass. An optional YAML check initially tried an unavailable standalone parser; the existing Playwright bundled parser verified the file without adding a dependency. One dev health request hit a watcher restart; direct and proxied readiness passed once it settled. No outstanding local application test failure remains.

Artifacts: latest Playwright report/screenshots under ignored `.cache/playwright/` are the final two-scenario rerun (the full 22-result report was read before replacement). The successful isolated dependency/release check is `.cache/m9-clean-65c5f9e889e846f8800deb48d4f9c310/`; the earlier failed offline install is also ignored. Smoke runtime databases were random OS-temp directories and were cleaned only after path checks; the user's data was never used. No production account was created by these tests.

Still outstanding: start Docker Desktop in Linux-container mode and run `docker build -t bid-and-build:m9 .` then `npm.cmd run test:docker`. Exercise production container `admin:create` / `admin:reset-password` privately with `docker exec -it`. Publish only after review and require the first hosted Ubuntu CI run to pass; then verify actual Coolify HTTPS/proxy, one replica/stop-before-start logs, persistent volume permissions, redeploy and off-server backup/restore. Real phone bars/safe areas, OS keyboard/touch/file pickers, Safari/Firefox, screen readers and TV mirroring remain manual. Automated viewport/zoom checks do not substitute for those devices.

Owner check: open **http://localhost:5173/builder**, import `samples/dragon-game.json`, save and host. Join from a separate browser/profile, bid, refresh one player, verify the pause and host Resume, then finish and Play Again. Review the new backup/restore rehearsal in `docs/BACKUP-RESTORE.md` and deployment checklist before publication. Suggested commit: **`M9: deployment-ready build`**. Existing M2–M9 work remains uncommitted; review how to group it. Stop at this milestone checkpoint.

Milestone 8 implementation and review (history):

- Read AGENTS.md, PROJECT_BRIEF.md, CODEX_PROMPTS.md and current progress; inspected the working tree and tools before implementation. Preserved existing M1–M7 work, data and secrets. Selected verified Node 24.22.1 / npm 11.19.1 (system defaults remain unsupported Node 25.5.0 / npm 11.8.0); Git is 2.52.0. Used the Sites skill's local workflow in the existing checkout. No new dependency, lockfile entry, service, schema migration, commit, push or deployment was introduced for M8.
- Added one Appearance panel, available in the site header, player Game menu and shared-display header. Minimal/Glass/Neon/Paper, light/dark mode, accent picker/hex entry, local image upload/removal, a clear image thumbnail, live page preview, glass surfaces and Reset to Defaults are implemented. Save is explicit and says “Saved to this browser”; closing discards an unsaved preview. Reset immediately saves the default appearance while preserving drafts and all game/admin identity.
- Versioned, strictly validated small preferences use `bid-build.appearance.v1` in localStorage. Background PNG Blobs use the separate `bid-build-appearance` IndexedDB database. Guest draft storage is untouched. Personal image processing reuses the existing PNG/JPEG size/pixel/type checks and safe local re-encoding; no remote URLs or active image formats. Nothing is added to game snapshots, HTTP/socket commands, template exports or content uploads. Temporary Blob URLs are revoked when replaced.
- A new image transaction commits before its preference pointer. Failed localStorage writes preserve the old saved appearance and remove the new unused image when storage permits. Replacement/removal deletes only the prior image ID. Missing/corrupt saved data produces an explicit fallback notice; quota/denied-storage errors retain the unsaved preview and do not claim success. Reset reports incomplete image cleanup rather than claiming bytes were removed. Same-origin tabs receive preference changes and stale editor saves are rejected; separate profiles/devices retain their own choices.
- Shared semantic colour tokens now cover the entire client, including builder/admin fields, gameplay and dialogs. Extreme accents are adjusted to readable shades, with white/black action text chosen by contrast. Tests cover every preset in both modes and sampled accents, including worst-case black/white photography. Backgrounds use an 88% palette overlay and glass uses 92% opacity with blur; unsupported blur/reduced transparency has an opaque fallback. Reduced motion and forced-colour styling are included. Theme choices preserve typography, control locations, paged content and the established game compositions.
- Appearance opens in the existing native, focus-managed dialog with visual-viewport positioning and a scrollable body. Footer actions stay reachable in reduced keyboard space; pending image/save work disables Close. No zoom restrictions or page-overflow clipping were added. The existing short-window/accessibility reflow remains available outside normal target sizes.
- Verified that private seat recovery keeps the destination browser's theme; the original browser retains its own. The shared display has independent preferences and still consumes no seat, issues no bids and has no disconnect-pause effect. Appearance reset preserves a real recovered host credential and current balances, in addition to saved local drafts and unrelated browser keys.
- Added `docs/APPEARANCE.md`; updated README and game-screen documentation. No Milestone 9 Docker, CI, deployment, publishing or final deployment-handoff work was started.

Milestone 8 checks actually run:

| Command / check | Result |
| --- | --- |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed on final application/test source |
| `npm.cmd test` | **226 tests passed in 9 files**, including eight new preset/mode contrast cases and all previous engine, room/recovery, administrator, template and foundation checks |
| `npm.cmd run build` | Server and production client built successfully; also rebuilt by browser commands. Largest client chunk remains below the build warning threshold |
| `npm.cmd run test:e2e -- tests/e2e/appearance.spec.ts` (initial focused run) | All five initial M8 scenarios passed, including 2/3/5-player theme/viewport/phase matrices |
| `npm.cmd run test:e2e` (final full run) | **19 scenarios passed** in 3.3 minutes: six M8 scenarios plus all thirteen prior admin/gameplay/display/recovery scenarios |
| `npm.cmd run test:e2e -- --grep 'M8 themed result'` | **One subsequently added scenario passed** (30.2 seconds including setup): multiple purchased items, complete bid-history detail pages, unclaimed results and description navigation in every preset at every target viewport. The repository now has 20 browser scenarios; all passed across the full and focused runs |
| `node scripts/check-builder-browser.mjs` | Full dedicated guest-builder regression passed: edit/reorder, PNG/JPEG handling, invalid uploads, IndexedDB save/refresh/copy, JSON export/import, quota/conflict handling, four viewport sizes and absence of draft/image writes |
| Storage/privacy browser checks | Saved appearance/background survive reload; other profiles remain independent; failed image/preference writes preserve old data and clean staged bytes; removal cleans the old image; corrupt/missing/denied storage is recoverable; real seat and drafts survive reset; host HTTP and bid socket payloads/exports omit appearance data |
| Responsive/accessibility checks | All four presets with custom accent/background/glass for 2, 3 and 5 players at 360×640, 390×844, 1280×720 and 1440×900 across lobby/bidding/paused/reveal/results. Actual button bounds/clickability and panel fit checked, alongside long names/options, all-in dialogs, public paging, display layouts, reduced-motion/transparency emulation, reduced keyboard space and zoom/reflow |
| Screenshot inspection | Phone glass bidding, phone paper results, default neon desktop, paper landscape display and the appearance panel inspected. Readable controls and balances; normal page fit retained |
| Runtime and repository checks | Home/builder returned 200 on port 5173; `/health` returned ready at unchanged schema 4 on port 3000. `git diff --check` passed; `.env`, data, tools and caches remain ignored |

Verified screenshots were preserved in ignored `.cache/m8-reviewed/` before the final focused run replaced Playwright's output. Its latest report is under `.cache/playwright/`. Dedicated builder artifacts are in `.cache/browser-m3/run-Ok2jsO/`. Browser/database fixtures are isolated from user data; the checkerboard photo and sample game content are explicitly test fixtures. Storage-full/denial checks inject browser failures; they do not fill the owner's disk.

Verification corrections: removed a redundant effect used to initialize the panel, fixed strict test-context typing, and corrected the new host-flow test selector from “Create room” to the existing “Create room & play” label. That selector caused the first expanded full suite to report 18 passes/one timeout; the corrected final full run passed all 19. Contrast measurements informed the background overlay/alpha, and an additional test closed the coverage gap for enabled result/history pagers with multiple purchases. No outstanding application check failure remains.

Still manual/unverified: physical phone touch/file pickers, browser bars and safe areas, real OS keyboard dismissal/panning, Safari/Firefox, screen-reader behavior, reduced-transparency settings on other platforms and TV mirroring. Headless viewport/zoom/media emulation is not a real-device claim. Docker/Linux/Coolify and production deployment are not verified in this milestone and remain the next milestone's scope.

Owner review: open **http://localhost:5173**, choose **Appearance**, select a preset, accent and background, then **Save appearance**. Refresh and compare another browser profile; its appearance must remain independent. In a game, use **Game menu → Appearance**; refresh preserves the seat but still pauses play until host Resume. Try Reset and confirm your saved draft and identity remain. Suggested commit: **`M8: local themes and responsive polish`**. Existing M2–M8 work remains uncommitted; review how to group it. Codex has made no commit.

Stop before Milestone 9. Resume only after the owner's next instruction.


Milestone 7 implementation and review:

- Read AGENTS.md, PROJECT_BRIEF.md, CODEX_PROMPTS.md and the existing progress; inspected files and installed tools. Preserved the owner's work, local secrets and application data. Verified Node 24.22.1 / npm 11.19.1 / Git 2.52.0. Used the Sites skill's local workflow in this checkout; no site registration, publishing, deployment or subagents. No dependencies or lockfile entries were added for M7.
- Added migration 4 for administrator accounts, durable sessions/rate counters, templates and owned image BLOBs. Existing migrations remain unchanged. The legacy migration test retains prior room state, seat credentials and image bytes. The existing app database migrated normally when development restarted; no reset or test fixtures were applied to it.
- Added private interactive `npm run admin:create` and `npm run admin:reset-password`, compiled into the production server output. Credentials are hidden, never echoed or accepted as arguments/piped input. Both resolve the app's same `.env`/DATA_DIR. Reset changes only the named account and revokes its sessions; games and unrelated accounts remain untouched. The owner still needs to create their actual account privately.
- Passwords use Node's asynchronous, salted scrypt at N=131072/r=8/p=1 with explicit memory limits. SQLite stores session token verifiers, with 12-hour absolute/two-hour idle expiry and logout/reset revocation. Production uses a host-only Secure/HttpOnly/SameSite=Strict cookie. Routes enforce current admin permission, exact Origin, JSON content type, session-bound CSRF and durable login limits. Authority is rechecked after asynchronous image decoding. No public signup/password-reset API exists.
- `/admin` now supports login, list/create/edit/duplicate, confirmed deletion and publish/unpublish. The shared builder fields handle settings, options/order, descriptions and cover/option images. JSON import is available. Optimistic revisions reject stale writes; failed saves and expired sessions retain edits in memory, with native navigation confirmation. The guest builder keeps its IndexedDB drafts and explicit local-saving behavior.
- `/templates` presents paged public title/description/cover/count previews and guest hosting. No option text, IDs, images or order are returned by catalogue responses. Hosting resolves the full published template on the server and creates an ordinary playing host seat; saved request receipts recover a lost hosting response even after source deletion. Public cover routes stop serving unpublished/deleted templates.
- Templates, duplicates and room snapshots own separate image copies. Transactional edits/deletes remove only template-owned assets. Existing room snapshots/images remain intact, including future options when later revealed. Images pass shared schema limits plus Sharp decoding/re-encoding; no arbitrary URLs/paths, HTML or SVG. No public upload directory exists. Limits and the storage tradeoff are documented in `docs/ADMIN.md`.
- Game authority is unchanged: admin login never grants host commands, a special bidder, an extra seat or balance editing; recovery codes never authenticate admin. Display credentials are rejected on catalogue/admin writes. No Milestone 8 appearance controls or Milestone 9 deployment work was started.

Milestone 7 checks actually run:

| Command / check | Result |
| --- | --- |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed on final source |
| `npm.cmd test` | **218 tests passed in 8 files**; includes ten administrator/security/storage integration cases and the new catalogue SPA route, plus all previous engine/template/room/recovery checks |
| `npm.cmd run build` | Server/CLI and production client built successfully; also rebuilt by each browser run |
| `npm.cmd run test:e2e` with installed Chrome | **13 scenarios passed**: two new admin/catalogue scenarios plus all eleven prior gameplay/display/recovery scenarios |
| `npm.cmd run test:e2e -- tests/e2e/admin.spec.ts` | **2 passed** again on final source after native unsaved-navigation dialog and error-style fixes |
| `node scripts/check-builder-browser.mjs` | Full guest-builder regression passed: editing/reorder, PNG/JPEG processing and rejection, IndexedDB persistence/copies, import/export, conflict/quota handling, four target viewports and no draft/image uploads |
| Compiled `npm.cmd run admin:create` and `npm.cmd run admin:reset-password` in a real PTY | Both succeeded against isolated ignored `.cache/m7-cli-check-20261024`, including production-mode reset; no credential characters appeared in output. Separate verifier check accepted the new test password and rejected the old one |
| Compiled CLI invalid invocation checks | Non-TTY invocation and extra arguments exited 1 without echoing supplied values; no app account created |
| Screenshot inspection | Admin desktop and portrait forms and portrait public catalogue inspected; controls/labels readable, wrapping appropriate, forms intentionally scroll |
| Development HTTP checks | `http://localhost:3000/health` returned ready at schema 4; `/admin` and `/templates` returned 200 on port 5173 |

Browser artifacts: final admin screenshots/report under ignored `.cache/playwright/`; full builder regression under `.cache/browser-m3/run-ZWU0WG/`. Test credentials belong only to isolated temporary/ignored test data. Final focused Playwright run replaces its previous output directory; the full 13-scenario result above is the observed earlier run. Routine issues corrected during implementation: private-prompt control-character lint, strict nullable/header types, trailing whitespace, and an unfocused custom leave overlay replaced with a native dialog. No outstanding application check failure remains.

Still manual/unverified: the owner's private account creation/reset, real phone touch/file pickers/keyboards, Safari/Firefox, screen-reader behavior, TV casting, Docker/Linux/Coolify execution and production HTTPS/proxy configuration. CLI artifacts execute on Windows with production-mode configuration, but this is not a container-execution claim. Production deployment remains single-process with persistent `/data` and stop-before-replace behavior. See `docs/ADMIN.md` for exact terminal/container setup and rate/session limits.

Owner review: with Node 24 selected, run `npm.cmd run build` then `npm.cmd run admin:create` in a private terminal. Sign in at **http://localhost:5173/admin**, create a pictured design and Publish. In a separate browser profile, host it from **http://localhost:5173/templates**, invite one player and Start. Edit, unpublish and delete the source, then continue playing: original room options/images must remain. Suggested commit: **`M7: admin template collection`**. Existing M2–M7 work remains uncommitted; review how to group it. Codex has made no commit.

Stop before Milestone 8. Resume only after the owner's next instruction.


Milestone 6 implementation and review:

- Read the project instructions, brief, milestone prompt and prior progress; inspected the working tree and installed tools. Preserved all existing work, local secrets and user data. Used Node 24.22.1 / npm 11.19.1 / Git 2.52.0. No dependencies or lockfile entries were added for Milestone 6. Used the Sites skill's local-only workflow within this existing GitHub/Coolify checkout.
- New seats receive a 120-bit random room-scoped private code (six four-character groups). Added masked Show/Copy, confirmed Replace Code, and separate recovery entry available even when a room is full/started or the saved credential was revoked. Code replacement invalidates the old verifier and pending transfers. Codes never appear in public projection, join/display links, media URLs or application logs.
- Migration 3 adds verifier storage, short-lived handoffs and encrypted private response receipts; prior migrations remain unchanged. Existing snapshots default `sittingOut` to false. Preserved pre-M6 seats provision an initial private code on reconnect without silently replacing an existing code. Migration/legacy tests preserve existing identity, state and asset bytes.
- Recovery/takeover prepares a five-minute handoff; current control remains until the replacement socket attaches. The queued transaction consumes it and rotates the controlling verifier, then installs the replacement before revoking the prior socket. Old credentials cannot act or read protected state/media. Late old-close events cannot disconnect/pause the replacement. Continuous takeover does not falsely pause; actual disconnect/restart pauses remain until explicit host Resume. Host permission stays on the original seat.
- Browser HTTP mutations persist a random request key and payload fingerprint before sending. Transactional encrypted receipts support safe retry of interrupted create/join/recovery/takeover/replacement responses across refresh/restart. They do not create extra rooms/seats or rotate codes twice. Recovery still checks the current verifier on retries, so a replaced code cannot replay its old receipt. Keep SESSION_SECRET stable: it derives a separate AES-256-GCM receipt key as well as display capabilities.
- Added recovery limits of 20 attempts/IP and 100/room per ten minutes, alongside existing Origin/body/write limits. Counters are bounded and process-local; arbitrary forwarded-IP headers are not trusted. Room expiry removes verifiers, receipts and handoffs. Active controllers extend the documented 24-hour inactivity window; display-only traffic still does not.
- Retained automatic bidding/reveal pauses, full authoritative resync and original command receipt lookup without replay. Brief close/attach retries make ordinary refresh recover automatically while a persistently active duplicate tab still requires explicit takeover. Auction status opens full absent-player details. Missing-host messaging explains that only the original host's recovery restores host controls.
- Added pure confirmed host Sit Out while paused, validated against an offline non-host target on the server. Public cards and a live announcement identify it. It preserves purchases, balance and a binding lead; disallows new bids/automatic purchases; does not turn temporary absence into concession. Its returned player remains sitting out for this run. Play Again resets the flag, keeps seats and requires everyone connected before Start.
- No ordinary purchase/advance occurs while paused, including after Sit Out removes the final opponent. Resume reevaluates forced settlement at the existing bid/opening price. If only current-option concessions block funded remaining players, only that option is unclaimed; those players return next option. Confirmed End remains the sole settlement exception while paused. Added conservation/ledger/restart tests for these cases.
- Added `docs/RECOVERY.md`, updated README and multiplayer/game-screen/engine documentation. No Milestone 7 administrator feature, Milestone 8 appearance work, publishing or deployment was started.

Milestone 6 checks actually run:

| Command / check | Result |
| --- | --- |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed on final source |
| `npm.cmd test` | **207 tests passed in 7 files: 33 room/display/recovery + 95 engine + 46 template/image/editor + 33 foundation** |
| Production build via `npm.cmd run test:e2e` | Server TypeScript and Vite production builds passed without bundle warnings |
| `npm.cmd run test:e2e` with installed Chrome | **All 11 scenarios passed**, including the eight original layout/game/display cases and three new Milestone 6 scenarios; about 1.3 minutes |
| Browser recovery | Replaced code rejected; new code copied/recovered through the real UI in a fresh profile, full five-player room, host identity/bid preserved, old token rejected, no false pause, refresh still paused until Resume |
| Browser disconnection / Sit Out | Offline network, named absence, disabled paused Bid, explicit Resume absent, missed bid resync, preserved credential, cancelled/confirmed Sit Out, binding departed-player payment, next option and small-phone fit passed |
| Browser lost-response handling | Intercepted and dropped already-committed create/join responses; repeated original request keys, including join after refresh, restored the same credentials and exactly two seats |
| Server/engine recovery checks | Wrong/cross-room/replaced codes, encrypted/private storage, rate limits, full-room atomic swap, old actions denied, original host only, preserved purchases/concessions/lead, rollback, legacy upgrade, restart, expiry, no second charge and blocked paused actions passed |
| Screenshot inspection | Reviewed private-code and paused Sit Out phone screenshots. Corrected Close-button wrapping on the long private-panel title; bidding controls and all balances remain fitted |
| Local runtime / repository | Home and builder HTTP 200; health ready at schema version 3. `git diff --check` passed. No user data reset, commit, push or deployment |

Final focused browser recheck after the legacy-seat provisioning, dialog-width refinement and test timing correction: **`npm.cmd run test:e2e -- --grep M6` passed all 3 scenarios (13.6 seconds), including a fresh production build**. Final check and whitespace verification passed. Browser artifacts are ignored under `.cache/playwright/`; the latest report/screenshots contain this focused run, while the full 11-scenario pass is recorded above. Test databases and Chrome contexts are isolated from user data/profiles; the temporary test server shuts down after the suite. The unchanged builder's full dedicated regression last passed in Milestone 5; its real Host flow passed again in this milestone's browser suite.

Verification corrections: updated migration expectations from schema 2 to 3 and the old takeover test to expect revocation on replacement attach, not on preparation. Fixed TypeScript narrowing for persisted retry metadata and unused assignments in new tests. The first focused browser attempt matched both a dialog title and its identically labelled input; a specific input selector fixed the test. A later focused run exposed a timing error in the new test: it closed the guest tab before the bid was accepted, then expected that bid to bind. The captured state correctly retained the previous leader; the test now waits for both guest and host to observe the accepted bid before closing. Auction tests caught no economic regression. Test-only responses/screenshots may contain fixture credentials and must not be published as production logs.

Still manual/unverified: real phone connection changes, browser bars/virtual keyboards, safe areas, touch/zoom, screen readers, Safari/Firefox and TV mirroring. Docker/Linux/Coolify execution remains unverified. No administrator authentication has been implemented or claimed. Server-secret rotation invalidates encrypted retry receipts/display links, so preserve it through normal restarts.

Owner check: open **http://localhost:5173/builder**, host and join in separate profiles, and copy each private code from Game menu. Bid, close a player's tab, verify the pause, then recover that seat in a fresh profile and explicitly Resume as host. Confirm balances and binding bids remain. Try Replace Code and reject the old value; for a permanent guest departure, confirm Sit Out while paused, then Resume. Suggested commit: **`M6: reconnect and recovery`**. Milestones 2–5 remain uncommitted too; review the combined working tree when grouping commits. **Stop before Milestone 7.**

The entries below are historical milestone checkpoints; their earlier deferrals are superseded by the current Milestone 8 entry above.

Milestone 5 implementation and review:

- Preserved the existing engine, local drafts, room state, receipts, controller handling and financial rules. Refactored the player connection into `usePlayerRoom.ts` while retaining original receipt lookup and no automatic command replay. Existing work, `.env` and user data remain intact.
- Replaced the scrolling room page with a shared fitted board. Landscape has the current option/main content, adjacent balances/build summaries and reserved bidding controls; portrait has wrapped balances, central content and bottom controls. Room/display routes omit the normal site header/footer. Uses dynamic viewport height, safe-area padding and contained images; no body `overflow:hidden` or disabled zoom. Small/zoomed exceptional viewports may reflow vertically to preserve access.
- Added keyboard-operated Option/Details/Builds/History tabs, measured full-text pagination, all-player build selection, item/bid paging and complete/incomplete results. Current auction status, every balance and primary bidding controls remain visible while browsing. Game/option titles and full player names are reachable even when their compact labels truncate. Maximum currency amounts keep their digits together.
- Added leading/outbid/conceded/insufficient-funds/paused/disconnected/unclaimed/empty states, concise live status announcements, native modal focus handling and focus restoration. Actual screen-reader/browser-device behavior still needs manual review.
- Bid uses the authoritative minimum; More opens custom entry with Confirm/Cancel. Bet All has a separate exact-amount confirmation. Host controls live in Game menu; End explains binding settlement and Resume with absent players explains retained eligibility. Dialogs are scoped to the current run/auction/phase and positioned within the visual viewport. No countdown, manual awards/balance edits, scoring or spectator UI was added.
- Added locally generated invite QR codes and code/link sharing. Builder forms remain scrollable and local; real builder hosting still uploads only the template snapshot/content images.
- Any player can request a separate room-bound read-only display capability. It is domain-separated HMAC-SHA256 using the existing server secret and unique game ID; no database migration was needed. Shared-display links contain only this capability in a fragment, which is stored in tab sessionStorage and immediately scrubbed. The display never reads player storage or receives recovery/admin information. Secret rotation invalidates display links; normal restarts retain them.
- Display sockets use the same public projection but never attach a seat/controller or disconnect pause hook. They cannot issue commands, read receipts, authenticate as a player or keep a player/room alive. Display HTTP writes are rejected. Authenticated display media uses the existing future-option visibility boundary. Fullscreen and ordinary browser/device mirroring instructions are provided; no casting SDK was added.
- Added Playwright `test:e2e`, separate contexts, real production serving on isolated port 3197, temporary test databases/secrets, screenshots and failed-run traces. Test-only fixture designs are hosted via real HTTP APIs; commands go through the actual UI. The test server uses a longer reveal interval for inspection; production remains 1.8 seconds. The old rooms browser script now delegates to the maintained suite, including its original receipt/takeover coverage.
- Pinned `@playwright/test` 1.64.1, `qrcode` 1.5.4 and `@types/qrcode` 1.5.6 after checking registry engine metadata. Playwright/types are development dependencies; QR generation is local. One root lockfile and the existing native-package install policy remain. Installation reported zero known vulnerabilities.
- Added `docs/GAME-SCREENS.md`; updated README, multiplayer and dependency documentation. No Milestone 6 recovery-code or Sit Out implementation, theme work, administrator feature, commit, push or deployment was performed.

Milestone 5 checks actually run (Node 24.22.1 / npm 11.19.1 / Git 2.52.0):

| Command / check | Result |
| --- | --- |
| Project documents, working tree and tools | Read AGENTS/PROJECT_BRIEF/CODEX_PROMPTS/PROGRESS; preserved all existing Milestone 2–4 changes and selected local Node 24 |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed |
| `npm.cmd test` | **191 tests passed in 7 files: 23 room/display integration + 90 engine + 46 template/image/editor + 32 foundation** |
| `npm.cmd run build` | Production server/client build passed without bundle-size warnings |
| `npm.cmd run test:e2e` (also through `node scripts/check-rooms-browser.mjs`) | **8 Playwright scenarios passed** against the isolated real production server; final full run about 1.1 minutes |
| Fitted layout matrix | 2/3/5 players × 360×640, 390×844, 1280×720 and 1440×900; lobby, bidding, reveal and results. Checked page overflow, actual control bounds and clickability, all balances, current status and paged content access |
| Long content and keyboard | Five seats with long names, 120-character titles, 4,000-character descriptions, eight-character currency symbol and 1,000,000 budgets. Full text reached its final marker; results also fit. Arrow-key tabs and dialog Cancel focus restoration passed; Confirm/Cancel reachable at a reduced 390×340 viewport |
| Bidding/results | Custom bid, leading/outbid/conceded states, cancelled and confirmed Bet All, exactly one full-balance payment, insufficient funds while opponents continue, paid purchases, unclaimed items, complete/incomplete results and item/history pages passed |
| Existing multiplayer regression | Real builder Host, separate-profile join, QR visibility, refresh same seat, automatic pause, host Resume, binding End with Cancel/Confirm, Play Again, original old-run receipt query without replay and explicit controller takeover passed |
| Display/browser checks | Opened from a non-host player; no player credentials in link/network URLs, no seat/action controls, protected current image, no future content, fullscreen/refresh and no pause on display close. Player disconnect still pauses with a display open |
| Display/server checks | Wrong/missing/cross-room/player-as-display/display-as-player credentials, write/command/receipt denial, same public projection, future media rejection, restart persistence and expiry without player presence passed |
| `node scripts/check-builder-browser.mjs` | Existing full browser regression passed: real images, IndexedDB save/refresh/round-trip/concurrency, quota and invalid-input handling, unsaved navigation, four viewports, reachable controls, no draft uploads or uncaught exceptions |
| Screenshot review | Inspected small-phone 3/5-player bidding, maximum currency/text, long/incomplete results and landscape display. Corrected amount wrapping, excess result footer space and display bidding copy |
| Final source/runtime review | `git diff --check` and compatibility launcher syntax check passed. Development `/health` returned ready at schema version 2; development remains running on 5173. Playwright stopped its isolated server after the suite |

Final Playwright screenshots/report: ignored `.cache/playwright/results/` and `.cache/playwright/report/`. Final builder artifacts: `.cache/browser-m3/run-3MI1Rj/`. Tests never erase the user's data directory or use personal browser profiles. Graceful test-server cleanup validates its unique temporary path; forcible interruption can leave that isolated temporary directory behind.

Failures corrected during verification: reads and writes initially shared a rate counter, so repeated image/state reads incorrectly blocked hosting; separate read/write buckets now have a regression test. Fixed initial new-test imports/types. The receipt browser driver initially watched WebSocket frames alone; it now observes initial Socket.IO polling too. A new End test initially expected the already-revealed unbid option to be unplayed; it correctly remains unclaimed while later hidden options are unplayed. The existing auction contract was preserved. All final required application checks passed.

Still manual/unverified: real phone browser bars, virtual-keyboard panning/dismissal, safe-area cutouts, touch/zoom, QR scanning, screen readers, Safari/Firefox and actual TV casting/mirroring. Reduced-viewport Chromium checks are not a claim of real keyboard verification. Docker/Linux/Coolify execution remains unverified. Private recovery codes, Sit Out and full reconnect/bootstrap edge cases remain Milestone 6, including the previously documented lost host/join response before credential storage.

Owner check: open **http://localhost:5173/builder**, host a starter and join from a second profile. Play at desktop and portrait phone sizes; use Details/Builds/History, custom Bid and Bet All Cancel, then finish and page through Results. From either player's Game menu, open the shared display, try Fullscreen and close it during bidding; no seat or pause should result. Suggested commit: **`M5: fitted game screens`**. Existing Milestones 2–4 also remain uncommitted; review them when grouping commits. **Stop before Milestone 6.**

Milestone 4 implementation and review:

- Connected the existing engine, local builder, Express, Socket.IO and SQLite. Explicit **Host game** uploads a validated copy of the current template and its content images, creates the host's playing seat and opens the lobby. Editing/saving drafts remains local. No personal appearance data is included in the hosting payload.
- Added join by code/link, secure random room/seat credentials, an atomic five-seat limit and Start requiring 2–5 connected seats. The host has an ordinary budget and bidding controls. New joins close permanently after the first Start; Play Again keeps the seats and uses a new run ID. No spectator fallback exists.
- Migration 2 stores room snapshots, seat token verifiers, temporary images, settlements, purchases and command receipts. Per-room queues serialize commands; state, new ledger rows and receipts commit in one immediate transaction before acknowledgement/broadcast. Database uniqueness enforces one settlement/purchase per game/run/option. Ledger failure tests verify complete rollback.
- Command IDs are scoped by game/run/player. Identical retries return original receipts, and changed payloads cannot reuse an ID. Pending browser commands retain their original ID/run in sessionStorage; timeout/reconnect queries the receipt and fresh snapshot without replaying the command. Receipt queries run behind earlier queued commands and cannot read another seat's receipt.
- Same-browser refresh restores the existing seat. One seat has one controlling socket; a second tab is rejected until explicit takeover rotates its credential and revokes the old controller. Host permission remains attached to its existing seat. Credentials are absent from invite/image URLs, public state and application logs.
- Player disconnects persist a pause during bidding or reveal. Reconnection never resumes automatically. Host Resume can intentionally continue with an absent player, without treating absence as concession or repeatedly pausing for the same event. Confirmed End remains the explicit pause exception and settles a binding bid once. Private recovery codes and permanent-departure Sit Out remain Milestone 6.
- A single versioned public projection exposes only current/revealed options, public bids/builds, names and balances. Future option IDs, descriptions, titles and image references remain absent, including after an incomplete End. Authorised image routes reject even a correctly guessed future asset ID. New runs reset disclosure; content already seen cannot be erased from a player's memory.
- Sharp independently decodes and re-encodes hosted PNG/JPEG images, removes metadata, enforces size/pixel bounds and rejects corrupt/animated inputs. Room-owned PNG images are SQLite BLOBs under DATA_DIR, so room creation and expiry keep assets atomic. There is no static uploads directory. HTTP origin checks, request/message bounds and rate limits cover the new transport.
- Persisted 1.8-second reveals and host Next use the same queue and stale-auction checks. Restart restores active games paused without repeating purchases; Resume starts a fresh reveal interval when needed. Temporary rooms expire after 24 hours of inactivity, with live connections extending expiry every minute. Cascading cleanup affects only temporary room data and its owned images.
- Added a functional room UI for lobby, ordinary/custom bids, Give Up, separate confirmed Bet All, host controls, public history, builds and results. It uses normal scrolling at this milestone. Fitted layouts, paged panels, shared display, themes and administrator features have not been started.
- Added `docs/MULTIPLAYER.md`; updated README, dependency and template notes. Dependencies are pinned in the single root lockfile: Sharp 0.35.5 added; Socket.IO client 4.8.4 moved to production dependencies. Verified compatibility metadata and exercised Windows native image processing under Node 24. Existing SQLite/esbuild install-script policy remains intact.

Milestone 4 checks actually run (Node 24.22.1 / npm 11.19.1, Git 2.52.0):

| Command / check | Result |
| --- | --- |
| Folder, project documents, Git status and installed tool inspection | Preserved existing uncommitted Milestone 2/3 work; selected the existing local Node 24 toolchain |
| Package compatibility lookup and `npm.cmd install --save-prod --save-exact sharp@0.35.5 socket.io-client@4.8.4` | Completed; npm reported zero vulnerabilities; Windows Sharp decoder exercised |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed, including the final browser diagnostics changes |
| `npm.cmd test` | **188 tests passed in 7 files: 20 real-room integration cases + 90 engine + 46 template/image/editor + 32 foundation** |
| `npm.cmd run build` | Server and client production build passed without warnings |
| Real HTTP/Socket.IO integration | Passed 2/3/4/5-player broadcast consistency, host bidding, concurrent capacity race, same-price bid race, invalid/stale/spoofed commands, late joins, room isolation, missing/bad credentials and original-receipt deduplication |
| Persistence and financial checks | Passed injected purchase-write rollback, unique ledger constraint, paid automatic purchases, timer/Next race, binding/settled restart restoration, paused advancement, End, preserved prior-run ledger and fresh Play Again budgets |
| Presence/disclosure checks | Passed refresh without a new seat, host/guest disconnect pause, intentional resume with absence, takeover/old-token revocation, future-field/media secrecy, authenticated PNG retrieval and expired-versus-live asset cleanup |
| `node scripts/check-rooms-browser.mjs` against isolated production server on port 3001 | Passed separate-profile host/join, native PNG uploads and authenticated image rendering, bidding/Give Up, refresh/pause/resume, binding End, a complete 12-option run, Play Again and explicit controller takeover |
| Browser receipt/privacy checks | A genuinely committed command's saved pending ID queried its original receipt after refresh; no command replay or second charge occurred. Hosting sent only name/template. No credential URLs, edit-time uploads or uncaught exceptions |
| `node scripts/check-builder-browser.mjs` against development server | Full builder regression passed: IndexedDB refresh/round-trip/concurrency, image decoding/rejection, quota handling, unsaved navigation, four viewports, reachable controls, no network writes or uncaught exceptions |
| Browser viewport review | Room screenshots at 390×844 and 1280×720, no horizontal overflow; settled-price label corrected after screenshot review. Builder checked 360×640, 390×844, 1280×720 and 1440×900. Normal room scrolling is intentional; fitted gameplay remains Milestone 5 |
| Final source/runtime review | `git diff --check` passed; development `/health` returned ready with schema version 2. Temporary production test process stopped; development remains available on 5173 |

Latest multiplayer browser artifacts: ignored `.cache/browser-m4/run-mOVBUp/`. Final builder regression artifacts: `.cache/browser-m3/run-Tgo0v0/`. Browser checks use fresh profiles and the multiplayer server uses an isolated `.cache/m4-browser-server-*` database. Unit/integration databases use OS temporary directories; no test erases the owner's data directory.

Verification corrections: fixed two test lint warnings and the settled high-bid label. Installing dependencies while the old Vite process was running left obsolete dependency URLs and a blank development page; restarting development regenerated the cache. The initial restart also briefly interrupted health requests while the watcher settled. The final builder run passed with no failed HTTP requests; intentional request cancellations on React cleanup/reload are distinguished from network failures. No outstanding application check failure remains.

Still manual/unverified: actual phones, touch keyboards, abrupt network loss timing, Firefox/Safari, Docker/Linux and Coolify deployment. Private-code recovery, Sit Out and thorough reconnect/bootstrap edge cases remain Milestone 6; in particular, a lost host/join HTTP response before the credential reaches browser storage is not yet an idempotent bootstrap recovery flow. Published template ownership/administration remains Milestone 7. No fitted gameplay or shared-display verification is claimed.

Owner check: open **http://localhost:5173/builder**, choose a starter/load a draft and **Host game**. Open its invite link in a separate browser profile, join and Start. Bid as host, Give Up as guest, refresh the guest and verify the same seat returns with play paused. Resume as host, finish and Play Again; compare both screens' purchases and balances. Suggested commit: **`M4: authoritative multiplayer rooms`**. Milestones 2 and 3 also remain uncommitted; review their existing changes when grouping commits. Stop before Milestone 5.

Milestone 3 implementation and review:

- Preserved the supplied sample's format `bid-and-build-template`, version 1, core fields, option IDs and order. `shared/template.ts` validates unique IDs, bounded text, settings, supported versions, embedded images and total image bytes. The sample is explicitly selectable, never an automatic fake saved draft.
- Added complete title/description/settings editing, cover and option image upload/view/remove, option add/duplicate/remove, drag reordering, keyboard-operable Move up/down, an option selector and live card/game previews. Validation appears beside fields; forms use normal vertical scrolling. Host is visibly disabled pending Milestone 4.
- Added multiple named drafts in native IndexedDB, explicit Save, Load, Delete, Save as copy, last-loaded/saved restoration, import and complete JSON export. Commits are transactional; stale revision checks prevent cross-tab overwrites. Failed writes retain edits and show unsaved/error state. Invalid imports leave the editor intact. Navigation/reload protection warns about unsaved edits.
- Images are actual embedded bytes. PNG/JPEG input is checked for type, size and pixel bounds before decoding, then resized/re-encoded locally to PNG. Transparency survives. Imported images also decode/re-encode sequentially. No draft or image uploads occur. Limits and representation are documented in `docs/TEMPLATE-FORMAT.md`.
- Added native-browser checks without new dependencies. The script uses isolated Chrome profiles and temporary fixtures under ignored `.cache/browser-m3`; no user browser profile or data directory is erased. Package dependencies and lockfile did not change.
- Builder is lazy-loaded. Production verification exposed Vite `loadEnv` allowing the backend's `.env` `NODE_ENV=development` to select development React in a build. Vite now reads only its backend binding configuration without mutating build mode; production chunks are below the warning threshold. Root secrets remain outside client environment exposure. The canonical sample was added to the Docker build-input allowlist; Docker execution remains unverified.
- No multiplayer routes, sessions, room creation, uploads, server templates, themes or later milestone behavior were introduced. No changes to the existing engine implementation were needed for Milestone 3.

Milestone 3 checks actually run (Node 24.22.1 / npm 11.19.1):

| Command / check | Result |
| --- | --- |
| System tools and Git inspection | System Node 25.5.0/npm 11.8.0, Git 2.52.0; selected the existing portable Node 24 toolchain and preserved uncommitted Milestone 2 work |
| `npm.cmd run check` | ESLint and both strict TypeScript configurations passed |
| `npm.cmd test` | **168 tests passed in 6 files: 46 template/image/editor cases + 90 engine + 32 foundation** |
| `npm.cmd run build` | Server and client production build passed without warnings after the build-mode fix |
| `node scripts/check-builder-browser.mjs` with installed Chrome | Passed real editing, drag-event reorder, keyboard Move down, duplicate/remove, native file inputs, PNG resizing/transparency, JPEG conversion, image rejection, IndexedDB save/load/refresh/delete/copy, downloaded JSON and second-profile import with exact fixture-byte retention |
| Browser failure/privacy checks | Injected quota failure retained edits and original saved data; concurrent IndexedDB writes accepted only one matching revision; stale UI save showed unsaved state; invalid import did not replace editor; HTML-like text stayed inert; unsaved navigation could be cancelled; no draft/image network writes or uncaught browser exceptions |
| Responsive browser checks | 360×640, 390×844, 1280×720 and 1440×900; no horizontal overflow, controls reachable with at least 44px height; desktop and phone screenshots inspected. Builder scrolling is intentional; no gameplay fit claim |
| Production browser smoke | `npm.cmd start` on temporary port 3001 with isolated `.cache/m3-production-data`; built `/builder`, image edit, Save/refresh and JSON download passed in a fresh Chrome profile |
| Final source/runtime review | `git diff --check` passed; dependencies, lockfile and canonical sample unchanged; development `/health` returned ready. Temporary production process stopped after its smoke check |

Final full browser artifacts are under ignored `.cache/browser-m3/run-fWUpPS/`; the earlier screenshot-review run is `run-CwOg25/`. The optional reproducible browser command and platform-specific `CHROME_PATH` instructions are in `docs/TEMPLATE-FORMAT.md`. Initial test-driver issues (Enter needed its text event, and navigation confirmation needed an async wait) were corrected. Screenshot review found and fixed a misleading saved label after a stale write. No outstanding application check failure remains.

Still manual/unverified: actual phone touch/file-picker behavior, Safari/Firefox and browser-specific private-storage limits, and Docker/Coolify execution. The Chrome failure tests inject storage exhaustion; they do not fill the owner's disk. Templates are local to the browser profile and origin, so exports are needed to move between localhost, LAN and deployment addresses.

Owner check: open **http://localhost:5173/builder**, select **Use dragon starter**, edit/add/reorder an option and upload an image. **Save draft**, refresh, **Export JSON**, then import in a different browser/profile. Confirm all fields, order and images remain. Host game must still say it awaits Milestone 4. Suggested commit: **`M3: local game builder`**. Since Milestone 2 is also still uncommitted, review the existing engine changes before deciding how to group commits; Codex has made no commit.

Milestone 2 implementation and review:

- `shared/game.ts` defines bounded creation inputs, private state, strict scoped command schemas, ordered events and typed errors. `engine/transition.ts` implements creation and pure transitions; `engine/state.ts` validates snapshots and financial/phase invariants. `engine/index.ts` exports the API and preserves the original defaults function.
- The caller injects a unique game ID and stable seat/option IDs. Run IDs derive from a monotonically increasing run number; auction IDs derive from that run and the option index. There are no clocks, timers, randomness, transport, database or React dependencies in the engine. Play Again cannot reuse an old run ID.
- A one-player lobby is valid while waiting, but Start requires 2–5 seats. The host is an existing player ID, independent of array position. Actor identity must eventually come from the server session, not client input. No administrator or spectator role was introduced.
- Implemented exact opening/raise rules, arbitrary legal bid jumps, normal all-in bids, binding leader restrictions, sequential concessions, paid last-eligible purchases, independent balances, zero-eligible exhaustion and host Skip of unbid options. Purchases are the single build/ledger source; only settlement debits money.
- Lobby, bidding, reveal and finished phases use a separate pause flag. Pause freezes ordinary bidding/concessions/progression. Confirmed End is the explicit exception: it settles a binding leader once, marks later options unplayed, and finishes incomplete. End during a reveal cannot repeat the charge. End from a lobby cancels all options as unplayed.
- Play Again restores budgets, clears the current run's collections/history/concessions, keeps seats/settings/host and returns to a fresh lobby. Persisting prior-run ledger rows belongs to Milestone 4.
- Inputs and prior snapshots are never mutated. Accepted commands return detached, validated state/events; rejected commands retain the original state, emit nothing and include a typed error. Snapshot validation enforces balance conservation, unique settlements, legal recorded prices, stable references and coherent terminal results.
- Limits: IDs 64 characters, names 40, 200 unique options, whole currency up to 1,000,000, and run numbers up to 1,000,000. Revisions cannot exceed the maximum safe integer. Engine data contains private ordered option IDs and must not be broadcast directly.
- No dependency changes, schema migrations, browser changes or fake game state were needed. No multiplayer API, builder editing, recovery, presence handling, Sit Out control, reveal scheduler or public projection was added. Full transaction/command-receipt deduplication and database uniqueness remain Milestone 4 work; the engine is not a replacement for them.
- Edge cases, API examples and future integration boundaries are documented in `docs/AUCTION-ENGINE.md`; README reflects Milestone 2.

Milestone 2 checks actually run:

| Command / check | Result |
| --- | --- |
| `npm.cmd run check` under local Node 24.22.1 | ESLint and both TypeScript configurations passed |
| `npm.cmd test -- tests/engine.test.ts` | Initial 76 engine cases passed before the final boundary-validation additions |
| `npm.cmd test` after all engine changes | **122 tests passed in 5 files: 90 engine cases and 32 foundation cases** |
| `npm.cmd run build` after all engine changes | Server/engine and client build passed without warnings |
| Engine import/source review | No React, transport, database, clock or randomness dependencies |
| Resume after interruption | Implementation, tests, README and engine documentation intact; completed this progress handoff |

The engine tests cover 2/3/4/5 seats, rejection of one/six at Start, invalid numeric/input data, exact opening/raise and bid jumps, equal/late bids, all-in and leader restrictions, sequential Give Up, reset concessions, host permissions, unbid Skip, one broke player with two funded opponents, $3 funding exactly three $1 automatic purchases, non-unit opening prices, paused bidding/reveals, confirmed End with/without a binding bid, no double charge, finished/stale commands, fresh runs, immutable inputs and JSON rehydration. Four generated-game cases run 20 complete games each, checking balances against ledger costs and replaying each trace to the same final state.

All required Milestone 2 checks passed before the interruption. The resumed work completed documentation only; no new application verification failure is outstanding. No browser gameplay or real restart-recovery check is claimed for this engine-only milestone. The full suite does exercise the existing HTTP/SQLite/Socket.IO foundation with isolated temporary storage.

Owner review for Milestone 2: select Node 24 as above, then run `npm.cmd test -- tests/engine.test.ts --reporter=verbose` and review the cases and `docs/AUCTION-ENGINE.md`. The page shell can still be launched at the URL above, but bidding UI is not expected yet.

Suggested commit: `M2: tested auction rules`.

Foundation decisions (Milestone 1 history):

- One root npm project/lockfile; React 19.3.1, Vite 8.3.5, Express 5.3.0, Socket.IO 4.8.4, Zod 4.6.7 and better-sqlite3 13.0.3. TypeScript 6.0.3 matches typescript-eslint's supported range. See `docs/DEPENDENCIES.md` for the full rationale.
- System tools inspected: Node 25.5.0, npm 11.8.0 (through `npm.cmd`) and Git 2.52.0.windows.1. Downloaded Node 24.22.1/npm 11.19.1 into ignored `.tools/` and verified the official SHA-256. System installations and PowerShell policy were not changed.
- Explicit `allowScripts` policy denies an unnecessary inferred SQLite source rebuild and permits esbuild 0.28.2's install script. npm >=11.19.1 <12 is enforced so clean installs honor this policy. SQLite uses its bundled Windows x64 prebuild; no native compiler installation was needed.
- Cross-platform scripts include setup, dev, check, test, build, start and db:migrate. `db:migrate` uses compiled code: build before running it. The watched server uses Node's built-in `--watch` plus the tsx loader; the tsx CLI watcher stalled in this environment.
- Server and migration CLI discover root `.env` independently of the working directory. Setup uses exclusive file creation, generates a 48-byte random secret and never prints it or replaces existing settings. Root `.env`, `/data`, caches and portable tools are ignored.
- SQLite schema version 1 stores runtime metadata and migration history only. WAL, foreign keys, transactional migration, repeated initialization and failure rollback are in place. Room/purchase/admin schemas belong to their later milestones.
- Production SPA fallback is restricted to the five agreed route patterns. Reserved API/media/health paths and missing files return JSON errors. Content assets are not exposed through a static upload directory.
- Milestone 1 established shared settings validation and a pure default-settings function; Milestone 2 extends this boundary with the auction engine described above. Settings use the sample's field names, a 1–1,000,000 whole-currency limit and 1–8 character display symbols.
- Client shells exist at `/`, `/builder`, `/room/:code`, `/display/:code` and `/admin`. Availability labels make clear there are no saved drafts, created rooms, bidders, admin sessions or fabricated game state. Only the health indicator reads runtime state. Socket.IO emits an infrastructure protocol greeting only.
- Docker skeleton uses `node:24.22.1-bookworm-slim`, production-only dependencies, UID/GID 1000 and owned `/data`. Full Linux/container/redeploy/backup verification remains Milestone 9.

Unresolved blockers / verification limits:

- Docker CLI 29.7.2 is present, but the Docker daemon pipe is unavailable. No Docker build, container start or Linux run is claimed. Start Docker Desktop and follow README's optional foundation commands, or verify during Milestone 9.
- Real phone browser bars/keyboards, zoom, screen-reader interaction, manual keyboard navigation and LAN reachability have not been verified. Gameplay layouts and full Playwright coverage are later milestones.
- The supplied Coolify guide still describes the future finished product; its administrator commands do not exist yet. No GitHub or Coolify operation was performed.

Milestone 1 checks (retained history):

| Check | Result |
| --- | --- |
| Repository inspection / Git status | Existing instruction-pack commit preserved; no initial changes to overwrite |
| Registry version/engine/peer inspection and dependency installation | Compatible versions selected and pinned; initial audit reported zero known vulnerabilities |
| `npm.cmd run setup` and automatic predev setup | Created private root `.env`; subsequent setup preserved it |
| `npm.cmd ci --offline --cache .cache/npm` | Passed after the explicit script-policy fix; 298 packages installed from the lockfile/cache |
| `npm.cmd run check` | ESLint and both TypeScript configurations passed |
| `npm.cmd test` | **32 tests passed in 4 files**, using isolated OS temporary directories |
| `npm.cmd run build` | Server/client production build passed without warnings |
| `npm.cmd run db:migrate` twice | Schema version 1 both times; no repeat migration |
| Built migration CLI from `.cache/` with separate `DATA_DIR` | Passed; found root `.env` and resolved data relative to project root |
| `npm.cmd start` and HTTP requests | Production `/health` ready; home/builder/room/display/admin direct routes return HTML |
| `npm.cmd run dev` | Vite 5173 and backend 3000 both start with the built-in Node watcher |
| Temporary runtime verification script | Development `/api`, `/health`, `/media` proxy behavior and real polling/WebSocket handshakes passed; generated session secret absent from built client assets |
| Installed Chrome headless/CDP shell checks | All five shell types rendered with real Server ready state, no horizontal overflow; Builder link and refresh worked |
| Screenshot inspection | Desktop home and Builder, portrait home and room inspected; screenshots saved in ignored `.cache/browser-m1/` |
| `git diff --check` / ignored file review | No whitespace errors; `.env`, data, tools and caches excluded from Git |

The 32 automated cases exercise settings/config validation, secret generation/preservation, database reopening/idempotency, transactional DDL rollback/newer-schema rejection, HTTP readiness/routes/errors, two simultaneous real Socket.IO infrastructure clients with polling and WebSocket, and rejected unapproved origins. They do not simulate a multiplayer game.

Browser viewport checks included home 1280×720 and 390×844; Builder 1440×900 and 360×640; room shell 360×640; display shell 1280×720; admin shell 390×844. Home/Builder use normal vertical document scrolling. The checked room/display shells fit, but this is not verification of the later gameplay layout. Headless checks used isolated local profiles, no additional browser dependency, and no `test:e2e` placeholder. An initial browser harness selected Chrome's extension background target; selecting the page target resolved that harness error.

Failures corrected during verification: an Express error-handler lint warning; a large client chunk (health validation now uses its own small shared contract); the clean-install SQLite source-build inference; and a stalled tsx CLI watcher. Initial network/Chrome sandbox restrictions were handled through scoped tool approvals. No unresolved application check failure remains.

Milestone 1 owner check (retained): launch the dev server, open home and Builder, resize the window, use Tab to navigate, and refresh the builder route. Confirm the footer says **Server ready** and `http://localhost:3000/health` returns `ready`. Check that joining, editing and sign-in are clearly unavailable in the shell.

Milestone 1 was committed by the owner as `0eb1cb2` (`1: application foundation`).
