# Build progress

Milestone 1 is implemented and verified locally. Stopped at its review checkpoint on 22 October 2026. No later milestone has been implemented, and nothing has been committed, pushed or deployed.

| Milestone | Status | Verification / remaining work |
| --- | --- | --- |
| 1. Foundation and local runtime | Complete; awaiting owner review | Clean install, lint/typecheck, 32 tests, build, migrations, production/development HTTP and Socket.IO, and Chrome shell checks pass. Docker daemon unavailable. |
| 2. Auction engine | Not started | |
| 3. Local builder and template format | Not started | |
| 4. Multiplayer rooms and persistence | Not started | |
| 5. Finished player screens and shared display | Not started | |
| 6. Recovery and disconnect handling | Not started | |
| 7. Admin template management | Not started | |
| 8. Local themes and viewport polish | Not started | |
| 9. Docker, CI and deployment handoff | Not started | |

Codex: update the appropriate row after each milestone. Record real commands and outcomes, important implementation decisions, the next task, and outstanding user checks below. A feature is not verified merely because its code was written.

Current milestone: 1 — review checkpoint. Next task, only after the owner's request: Milestone 2, deterministic auction engine.

Current launch commands (Windows PowerShell from the repository root):

```powershell
# This machine's system Node is 25.5.0. Select the local verified Node 24:
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
npm.cmd run dev
```

Launch URL: **http://localhost:5173**. Backend health: **http://localhost:3000/health**. Development servers used for verification are stopped at handoff; use the command above to start them. On other machines, install/select Node 24 LTS and npm >=11.19.1 <12, then run `npm ci` and `npm run setup` first. README contains full commands and production preview instructions.

Current ports: frontend development 5173; server/production 3000. `npm start` serves the built client, API and sockets in one Node process. Root `.env` supplies development settings; runtime environment overrides it.

Implementation decisions:

- One root npm project/lockfile; React 19.3.1, Vite 8.3.5, Express 5.3.0, Socket.IO 4.8.4, Zod 4.6.7 and better-sqlite3 13.0.3. TypeScript 6.0.3 matches typescript-eslint's supported range. See `docs/DEPENDENCIES.md` for the full rationale.
- System tools inspected: Node 25.5.0, npm 11.8.0 (through `npm.cmd`) and Git 2.52.0.windows.1. Downloaded Node 24.22.1/npm 11.19.1 into ignored `.tools/` and verified the official SHA-256. System installations and PowerShell policy were not changed.
- Explicit `allowScripts` policy denies an unnecessary inferred SQLite source rebuild and permits esbuild 0.28.2's install script. npm >=11.19.1 <12 is enforced so clean installs honor this policy. SQLite uses its bundled Windows x64 prebuild; no native compiler installation was needed.
- Cross-platform scripts include setup, dev, check, test, build, start and db:migrate. `db:migrate` uses compiled code: build before running it. The watched server uses Node's built-in `--watch` plus the tsx loader; the tsx CLI watcher stalled in this environment.
- Server and migration CLI discover root `.env` independently of the working directory. Setup uses exclusive file creation, generates a 48-byte random secret and never prints it or replaces existing settings. Root `.env`, `/data`, caches and portable tools are ignored.
- SQLite schema version 1 stores runtime metadata and migration history only. WAL, foreign keys, transactional migration, repeated initialization and failure rollback are in place. Room/purchase/admin schemas belong to their later milestones.
- Production SPA fallback is restricted to the five agreed route patterns. Reserved API/media/health paths and missing files return JSON errors. Content assets are not exposed through a static upload directory.
- Shared settings validation and a pure default-settings function establish the engine boundary. Auction transitions have intentionally not been implemented. Settings use the sample's field names, a 1–1,000,000 whole-currency limit and 1–8 character display symbols.
- Client shells exist at `/`, `/builder`, `/room/:code`, `/display/:code` and `/admin`. Availability labels make clear there are no saved drafts, created rooms, bidders, admin sessions or fabricated game state. Only the health indicator reads runtime state. Socket.IO emits an infrastructure protocol greeting only.
- Docker skeleton uses `node:24.22.1-bookworm-slim`, production-only dependencies, UID/GID 1000 and owned `/data`. Full Linux/container/redeploy/backup verification remains Milestone 9.

Unresolved blockers / verification limits:

- Docker CLI 29.7.2 is present, but the Docker daemon pipe is unavailable. No Docker build, container start or Linux run is claimed. Start Docker Desktop and follow README's optional foundation commands, or verify during Milestone 9.
- Real phone browser bars/keyboards, zoom, screen-reader interaction, manual keyboard navigation and LAN reachability have not been verified. Gameplay layouts and full Playwright coverage are later milestones.
- The supplied Coolify guide still describes the future finished product; its administrator commands do not exist yet. No GitHub or Coolify operation was performed.

Checks actually run and results:

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

Owner review: launch the dev server, open home and Builder, resize the window, use Tab to navigate, and refresh the builder route. Confirm the footer says **Server ready** and `http://localhost:3000/health` returns `ready`. Check that joining, editing and sign-in are clearly unavailable in this milestone.

Suggested commit: `M1: application foundation`.
