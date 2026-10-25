# Bid & Build

A multiplayer auction party game for **2–5 players, including the host**. Create local designs with images, host a real room, invite friends and bid with server-authoritative balances. Rooms, purchase ledgers and receipts persist in SQLite. Refresh restores your seat; a private code recovers it on another device. Disconnects pause play until the host resumes, and confirmed Sit Out handles permanent departures. Fitted phone/desktop screens and a read-only shared display are available. Administrators can publish permanent templates; guests can browse and host them without an account. Each browser has its own saved appearance, including light/dark mode, accents, local backgrounds and Minimal/Glass/Neon/Paper presets. Docker packaging and Linux CI are supplied; actual Docker/Linux/Coolify execution is still awaiting an available daemon and the owner's publication. See the verification status below for results and remaining checks.

## Run locally

Use **Node 24 LTS**, **npm 11.19.1 or newer within npm 11**, and Git. Node 24.22.1 includes the tested npm version. The package engine constraint rejects other Node majors and older npm versions so dependency installation and deployment use the same baseline. In Windows PowerShell, use `npm.cmd` to avoid changing execution policy. Linux/macOS use `npm` for the same scripts.

```powershell
node --version
npm.cmd --version
npm.cmd ci
npm.cmd run setup
npm.cmd run dev
```

Open **http://localhost:5173**. The backend health endpoint is **http://localhost:3000/health**; `/health` on port 5173 is also proxied to it. Stop development with Ctrl+C. `dev` starts both processes, watches changes and runs setup automatically. Ports are strict so a second launch cannot silently switch the frontend to a different origin.

This machine initially had Node 25.5.0. For local verification, a checksum-verified portable Node 24.22.1 with npm 11.19.1 was downloaded into ignored `.tools/`. If it is still present, select it for the current PowerShell terminal before the commands above:

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
node --version
```

This does not change the system installation and is not included in Git. On another machine, install/select Node 24 LTS normally. `.nvmrc` and `.node-version` both specify 24. Do not run `npm ci` with Node 25 or reuse a dependency installation from a different Node major.

## Configuration and data

`npm run setup` creates root `.env` **only if it does not exist**, generating 48 random bytes for `SESSION_SECRET` without printing the value. It preserves even an incomplete existing `.env`; fix its settings yourself if startup reports invalid keys. No default password or administrator exists.

| Variable | Development default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `start` explicitly selects production serving |
| `HOST` | `0.0.0.0` | Server and Vite bind address |
| `PORT` | `3000` | Backend / production port |
| `DATA_DIR` | `./data` | SQLite directory, relative to repository root |
| `APP_ORIGIN` | `http://localhost:5173` | Allowed browser socket origin; no trailing slash |
| `SESSION_SECRET` | Generated locally | At least 64 characters; signs display capabilities and encrypts private retry receipts; keep stable across restarts |
| `TRUST_PROXY` | Empty | Comma-separated IPs/CIDRs of actual trusted reverse proxies; empty ignores forwarded client addresses. Never use `true`, a hop count or an all-addresses network |

The server and migration CLI locate the same root `.env` even if invoked from another working directory. Runtime environment variables override `.env`. Vite reads binding/proxy configuration on the server side; root `.env` is not a client environment directory. Never put secrets into `VITE_*` variables or commit runtime data.

Startup creates `DATA_DIR`, opens `bid-and-build.sqlite`, enables WAL and foreign keys, and applies schema migrations inside a transaction before listening. `/health` returns `{"status":"ready","service":"bid-and-build","schemaVersion":4}` only after initialization and a live database query. Shutdown stops admission, cancels room timers and drains admitted room/admin work before closing SQLite, including asynchronous work whose HTTP client disconnected. Transactions commit or roll back before exit. Allow a 30-second stop grace period; the process has a 25-second emergency deadline. Active rooms restore paused after restart; their host must explicitly resume.

For a production-style local preview, build and then use the same origin in the ignored `.env`:

```powershell
npm.cmd run build
# Set APP_ORIGIN=http://localhost:3000 in .env for this preview.
npm.cmd start
```

Open **http://localhost:3000**. Return `APP_ORIGIN` to `http://localhost:5173` before development. Production serves built client files, API and Socket.IO from one Node process. Direct navigation to `/builder`, `/room/EXAMPLE`, `/display/EXAMPLE`, `/templates` and `/admin` works. Example codes do not create rooms. Unknown API/media paths and missing assets return real 404 responses, never the SPA document. No upload directory is publicly served.

## Commands and checks

| Command | What it actually does |
| --- | --- |
| `npm run setup` | Create missing local `.env`; preserve existing settings |
| `npm run dev` | Run Vite on 5173 and the watched server on 3000 |
| `npm run check` | ESLint and strict TypeScript checks for client, server and tests |
| `npm test` | Non-watch Vitest tests with isolated temporary databases |
| `npm run test:e2e` | Build, then run four sequential browser shards, each with a fresh isolated production server/database on 3197; merge the report |
| `npm run build` | Compile server/shared/engine and build React client |
| `npm start` | Serve the existing build in production mode |
| `npm run admin:create` | Privately prompt to create an administrator in configured DATA_DIR; build first |
| `npm run admin:reset-password` | Privately reset one named administrator and revoke its sessions; build first |
| `npm run db:migrate` | Run **built** migrations against configured `DATA_DIR`; build first |
| `npm run db:backup -- NEW_DIR` | Online consistent SQLite/content-image backup with checksum and integrity checks |
| `npm run db:restore -- BACKUP_DIR NEW_DATA_DIR` | Validate and restore into a new directory; never overwrite existing storage |
| `npm run test:production` | Exercise the compiled server/CLI, restart and backup/restore with disposable storage; build first |
| `npm run test:docker` | Exercise the prebuilt `bid-and-build:m9` image using a disposable labelled named volume; requires a running Docker daemon |

Run `npm run build` before `db:migrate` so it includes the latest migration code. Ordinary server startup also migrates automatically. Never edit an applied migration; append a versioned migration to `server/db/migrations.ts`. Unknown/newer schema history fails startup instead of silently downgrading data. Keep separate data directories for local work, tests and deployment; tests never clear `./data`.

The tests cover the pure engine, templates/images, configuration, migrations, HTTP and real Socket.IO multiplayer: 2–5 seats, concurrent joins/bids, receipts, rollback, restart, atomic takeover/recovery, automatic pause, Sit Out and future-content/media disclosure. Installed-Chrome checks cover the [local builder](docs/TEMPLATE-FORMAT.md). Playwright covers fitted layouts, multiplayer flows and display permissions, plus [private recovery and interrupted requests](docs/RECOVERY.md). Set `CHROME_PATH` to an installed Chromium executable, or install Playwright Chromium with `npx playwright install chromium` first. Administrator authorization, template storage and private setup commands are documented in [docs/ADMIN.md](docs/ADMIN.md).

Recovery check: open **Game menu → Private recovery code** and keep a private copy. After a disconnect, open the room link in another browser profile, choose **Recover an existing seat**, and enter that code. The original host must explicitly Resume. Recovery works in full rooms and preserves money and binding bids. **Replace Code** invalidates the previous code; **Sit Out** is a separate confirmed host action for an offline permanent departure. Details, expiry and restart behavior are in [docs/RECOVERY.md](docs/RECOVERY.md).

Foundation check: open home and Builder, resize to a narrow phone viewport, navigate with Tab, and verify the footer says **Server ready**. Refresh each route directly. Confirm `/health` says `ready`. Administrator login is available after private CLI setup.

Engine check: run `npm.cmd test -- tests/engine.test.ts --reporter=verbose`. Tests cover sequential concessions, paid automatic purchases, binding bids, paused actions, terminal End and deterministic full-game traces. Auction rules are retained in AGENTS.md.

Builder check: open **http://localhost:5173/builder**, select **Use dragon starter**, edit the title/options, upload a PNG or JPEG, and **Save draft**. Refresh, export JSON, and import it in another browser profile. Check that text, order and images survive. **Save as copy** duplicates the open draft. Saving is explicit; edits show **Unsaved changes** and successful saves say **Saved to this browser**. Export backups before clearing site data or moving origins. Editing and saving send no drafts to the server; explicit hosting sends a temporary game copy.

Multiplayer check: **Host game**, enter your player name, and open the invite link in another browser profile. Join and Start, then bid and Give Up. Refresh the guest; verify the same seat returns and the host must Resume. Finish the run and try Play Again. A second controlling tab requires explicit takeover.

Gameplay check: resize between desktop and portrait phone. Check that every balance, current option, high bid and main action stays visible. Inspect the inline collections, persistent phone Your build and Compare builds, then compare everyone together in results. Use Details/History for longer information; use **More** for a custom bid or confirmed Bet All. **Game menu** holds host controls, invite link/QR and **Open shared display**. Open that display on another screen, try Fullscreen and close it during play; it must not occupy a seat or pause the game. For casting, use ordinary browser/device mirroring controls; actual device casting remains a manual check. No native casting SDK is used.

## Administrator setup

From a private interactive terminal in this repository, select Node 24, then run:

```powershell
npm.cmd run build
npm.cmd run admin:create
```

Enter a username and a 15–128 character password twice at the hidden prompts. Do not put credentials in command arguments, environment variables or chat. There is no default account or public signup. The CLI uses the same root `.env`/`DATA_DIR` as the app and can run while games are active. Sign in at **http://localhost:5173/admin**, create and save a template, then Publish. Guests browse and host at **http://localhost:5173/templates**. The host gets an ordinary player seat; future options stay server-side until revealed.

To reset one account privately, run `npm.cmd run admin:reset-password` and complete its hidden confirmation. That account’s sessions are revoked; other accounts and games are preserved. In a configured production container, use `docker exec -it YOUR_APP_CONTAINER npm run admin:create` or `docker exec -it YOUR_APP_CONTAINER npm run admin:reset-password`. Compiled commands use production dependencies; no `tsx` is needed. HTTPS and the exact `APP_ORIGIN` are required for deployed admin cookies. Full bootstrap, limits, image ownership and remaining machine checks: [docs/ADMIN.md](docs/ADMIN.md).

Review check: publish a design with pictures, host it as a guest in another browser profile, and invite a second player. Start, then edit/unpublish/delete the source; the active room must retain its original content and images. Guest drafts still save locally without login.

## Appearance

Open **Appearance** in the site header or **Game menu**; the shared display has its own Appearance button. Changes preview immediately. **Save appearance** keeps them in this browser; closing the panel discards unsaved changes. Choose Minimal/Glass/Neon/Paper, light/dark mode, an accent, a local PNG/JPEG background and glass surfaces. **Reset to Defaults** preserves drafts and player identity.

Personal backgrounds and preferences are never uploaded or included in template exports. A recovered seat uses the destination browser’s appearance. The existing phone/landscape layouts keep their controls and compact acquired collections across themes. Check saved appearance, cancellation and Reset on each device; Reset must preserve drafts and player identity. Reduced-motion and accessibility reflow remain supported.

## Project boundaries

- `client/`: React builder, local images/drafts, room connection/credentials, fitted player/display boards, compact collections, description/history pages and styles.
- `server/`: Express, Socket.IO room authority, image validation, command queues/receipts, persistence and migrations.
- `shared/`: Shared validated templates/images/settings, private game state, scoped commands and events. Numeric settings use positive whole numbers capped at 1,000,000; the display symbol is 1–8 characters.
- `engine/`: Pure validated auction transitions and snapshot invariants, independent of transport, storage, clocks and randomness.
- `tests/`: Real multiplayer and persistence cases, template/image cases, engine traces and runtime/schema checks with temporary storage.
- `scripts/`: Cross-platform setup/launcher and optional isolated Chrome builder/multiplayer checks.
- `docs/`: Runtime decisions, backup/restore procedure and the reconciled Coolify guide.

Room events use authenticated stable seats, one active controller, ordered transactions and a single public projection. Hidden options stay out of payloads and media routes until revealed, including after an incomplete End. Temporary images are room-owned SQLite BLOBs, so the room snapshot and assets persist and expire together. There is no publicly served upload directory. Guest drafts remain local until explicitly hosted; personal appearance and background images stay local even when hosting.

## Phone testing on your LAN

Use the Windows PC's private IPv4 address from `ipconfig`, for example `192.168.1.25`. Stop development, set `APP_ORIGIN=http://192.168.1.25:5173` in the ignored `.env`, keep `HOST=0.0.0.0`, and restart `npm.cmd run dev`. Open that **same LAN URL** on the PC and phones connected to the same private network. Allow Node's port 5173 through Windows Firewall on the private network if prompted; no router port forwarding is needed. Vite proxies backend and WebSocket traffic. Using localhost on the PC while the configured origin is the LAN address will reject mutations. Restore the localhost origin afterward.

Each origin/browser keeps its own guest drafts and appearance. Export/import a draft to move it from localhost to the LAN address; use a private recovery code for a seat. This is a real-device development check, not production HTTPS verification. Confirm phone browser bars, rotation, touch, file pickers and keyboard dismissal, then try normal screen mirroring from the display. These hardware checks remain manual.

Hosting, joining and private-code recovery support ordinary LAN HTTP. Request retry fingerprints use browser-compatible SHA-256 because `crypto.subtle` is unavailable on these origins (localhost is treated differently). If an older tab reports `Cannot read properties of undefined (reading 'digest')`, restart development after installing the updated dependencies, then reload the phone page. Keep `APP_ORIGIN` equal to the actual LAN URL; the fix preserves origin validation and secure random credentials.

During `[server] Restarting 'server/main.ts'`, Vite can briefly log `ECONNREFUSED 127.0.0.1:3000` while the backend listener is down. Clients reconnect after the server reports it is listening. An interrupted game returns paused, with the same seats, bids and purchases; the host must choose Resume. If refusals continue after startup, check that the backend stays running and `PORT` matches Vite's API target (3000 by default).

## SQLite, backups and Docker

The locked `better-sqlite3` 13.0.3 package supports Node 22+ and ships native prebuilds, including Windows x64 and Linux glibc. Its SQLite 3.53.4 binding was exercised on Windows with Node 24.22.1. No C++ build tools were needed here. `package.json` explicitly denies its unnecessary install script: a clean npm install otherwise inferred `node-gyp rebuild` from the bundled source. The reviewed esbuild 0.28.2 install script is allowed. These policies require the documented npm version. A source-build fallback would require Python 3 and Visual Studio Build Tools with Desktop development with C++ on Windows, or Python 3, make and g++ on Debian, plus a deliberate script-policy change. Use the package's build instructions if a prebuilt binary is unavailable; do not replace the database driver or install global toolchains silently. Dependency decisions and primary references are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

Sharp 0.35.5 handles server-side image decoding/re-encoding using its native prebuilt package. Its Windows x64 path was exercised with Node 24; the lockfile also includes the Debian/Linux x64 optional packages. Keep optional dependencies enabled, install on the target OS and never copy Windows `node_modules` into Docker. Linux container execution remains unverified here. See the dependency notes for requirements and the official installation reference.

`Dockerfile` uses Debian Bookworm Node 24.22.1 and explicitly selects npm 11.19.1 to enforce the reviewed install-script policy. It builds on Linux, installs only production runtime dependencies, and runs Node directly as `node` (UID/GID **1000:1000**). `/data` is owned by that user. The image includes built admin, migration, backup and restore commands. Secrets, local databases, tools, tests and unnecessary artifacts stay outside the allowlisted build context. Runtime serves one process on `0.0.0.0:3000`, with an HTTP health check and SIGTERM shutdown. Docker execution has not been verified locally because the daemon is unavailable.

After starting Docker Desktop in Linux-container mode, run:

```powershell
docker build -t bid-and-build:m9 .
npm.cmd run test:docker
```

The smoke test creates a unique labelled test volume, runs the actual image, creates test content/admin data, checks native image bindings, stops/recreates the container, verifies sessions/private recovery and one ledger charge, then runs backup/restore in separate storage. It removes only its own test containers/volume. It checks that compiled private admin commands load and reject non-interactive input; manually exercise their hidden prompts with `docker exec -it` as described in the guide. No user volume or local DATA_DIR is used.

Back up with `npm run db:backup -- ./backups/NEW_NAME` after creating the parent `backups` directory. All server images are BLOBs in the same SQLite snapshot; never rely on copying a live database file alone. Restore with `npm run db:restore -- BACKUP_DIR NEW_DATA_DIR`. See [the full backup/restore procedure](docs/BACKUP-RESTORE.md) for tested separate-storage restore, secrets, expiry and schema rollback.

The [Linux CI workflow](.github/workflows/ci.yml) performs clean install, lint/typecheck, unit/integration tests, build, compiled production smoke, all Chromium scenarios and the Docker named-volume smoke. It has read-only repository permissions and no deployment credentials or publishing steps. Its first hosted Linux run remains outstanding until the owner publishes the repository. Local checks do not prove the Linux image passed.

After completing the checks below, review/commit the source, tests, one root lockfile and documentation in VS Code, publish to your intended GitHub repository and require a green Linux CI run. Then follow [the Coolify guide](docs/COOLIFY-SETUP.md): one instance, persistent `/data`, stable secret, actual HTTPS origin, and **Consistent name (no rolling updates)** with a 30-second stop grace period. Verify the old process stops before its replacement starts.

## Verification status

Last application verification (25 October 2026): lint and both TypeScript checks, production build, **230 unit/integration tests** and **28 browser scenarios** passed. LAN HTTP joining, private recovery, lost-response retries and restart with a binding bid are covered. These are recorded results, not a claim that later edits have been tested. The documentation cleanup checked local links and removed stale references; it did not change application code or rerun application tests.

The full browser runner uses four sequential isolated shards with temporary databases. LAN tests additionally use port 3198 and a Chromium-only hostname mapping to exercise an actual insecure HTTP context. Focus them with `npm.cmd run test:e2e -- tests/e2e/lan.spec.ts`. Reports are in ignored `.cache/playwright/report/`; traces contain test credentials and should remain private.

Before deployment:

- Test on actual phones and intended desktop browsers: joining, bidding, refresh/pause/Resume, private recovery, browser bars, rotation, keyboards, touch, zoom, screen readers and shared-display mirroring. Use separate profiles for independent players; tabs in one profile share a seat.
- Run the Docker smoke test and require passing hosted Linux CI. Docker/Linux/Coolify execution has not yet been verified here.
- Verify HTTPS/admin sessions, exact origin/trusted proxy settings, persistent storage and stop-before-start updates with a paused game and no duplicate charge.
- Rehearse backup and restore into separate storage, keeping the matching secret privately and an off-server backup.
- Address the existing high-severity transitive body-parser advisory recorded in [dependency notes](docs/DEPENDENCIES.md).

Documentation: [project rules](AGENTS.md), [deployment](docs/COOLIFY-SETUP.md), [backup/restore](docs/BACKUP-RESTORE.md), [admin](docs/ADMIN.md), [seat recovery](docs/RECOVERY.md), [template format](docs/TEMPLATE-FORMAT.md), and [dependencies/native requirements](docs/DEPENDENCIES.md).
