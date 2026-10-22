# Bid & Build

A multiplayer auction party game for **2–5 players, including the host**, built in reviewable milestones. Milestone 1 supplies the real local runtime and responsive page shells. Games, the builder editor, recovery, administrator login and appearance controls are not implemented yet. See [PROGRESS.md](PROGRESS.md) before continuing development.

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

This machine initially had Node 25.5.0. For Milestone 1 verification, a checksum-verified portable Node 24.22.1 with npm 11.19.1 was downloaded into ignored `.tools/`. If it is still present, select it for the current PowerShell terminal before the commands above:

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
| `SESSION_SECRET` | Generated locally | At least 64 characters; reserved for future sessions |

The server and migration CLI locate the same root `.env` even if invoked from another working directory. Runtime environment variables override `.env`. Vite reads binding/proxy configuration on the server side; root `.env` is not a client environment directory. Never put secrets into `VITE_*` variables or commit runtime data.

Startup creates `DATA_DIR`, opens `bid-and-build.sqlite`, enables WAL and foreign keys, and applies schema migrations inside a transaction before listening. `/health` returns `{"status":"ready","service":"bid-and-build","schemaVersion":1}` only after initialization and a live database query. Shutdown closes sockets, HTTP and the database. There is no room state to restore in this milestone.

For a production-style local preview, build and then use the same origin in the ignored `.env`:

```powershell
npm.cmd run build
# Set APP_ORIGIN=http://localhost:3000 in .env for this preview.
npm.cmd start
```

Open **http://localhost:3000**. Return `APP_ORIGIN` to `http://localhost:5173` before development. Production serves built client files, API and Socket.IO from one Node process. Direct navigation to `/builder`, `/room/EXAMPLE`, `/display/EXAMPLE` and `/admin` works. Example codes do not create rooms. Unknown API/media paths and missing assets return real 404 responses, never the SPA document. No upload directory is publicly served.

## Commands and checks

| Command | What it actually does |
| --- | --- |
| `npm run setup` | Create missing local `.env`; preserve existing settings |
| `npm run dev` | Run Vite on 5173 and the watched server on 3000 |
| `npm run check` | ESLint and strict TypeScript checks for client, server and tests |
| `npm test` | Non-watch Vitest tests with isolated temporary databases |
| `npm run build` | Compile server/shared/engine and build React client |
| `npm start` | Serve the existing build in production mode |
| `npm run db:migrate` | Run **built** migrations against configured `DATA_DIR`; build first |

Run `npm run build` before `db:migrate` so it includes the latest migration code. Ordinary server startup also migrates automatically. Never edit an applied migration; append a versioned migration to `server/db/migrations.ts`. Unknown/newer schema history fails startup instead of silently downgrading data. Keep separate data directories for local work, tests and deployment; tests never clear `./data`.

The current tests cover settings/configuration validation, secret generation and preservation, SQLite persistence/repeated initialization/transaction rollback, real HTTP routes and errors, and real Socket.IO clients over polling and WebSocket with origin rejection. They do not claim auction, recovery, authorization or browser layout coverage. `test:e2e` and administrator CLI commands will be added when those features exist.

Manual Milestone 1 check: open home and Builder, resize to a narrow phone viewport, navigate with Tab, and verify the footer says **Server ready**. Refresh each shell route directly. Confirm `/health` says `ready`. Joining, saving and login should be clearly unavailable.

## Project boundaries

- `client/`: React route shells and styles. The health indicator reads the real server.
- `server/`: Express, Socket.IO infrastructure, environment loading and SQLite adapter/migrations.
- `shared/`: Shared validated contracts. Numeric settings use positive whole numbers capped at 1,000,000; the display symbol is 1–8 characters.
- `engine/`: Pure default-settings module; deterministic auction transitions are Milestone 2.
- `tests/`: Runtime and schema smoke tests with temporary storage.
- `scripts/`: Cross-platform environment setup and production launcher.
- `docs/`: Runtime decisions and the supplied future Coolify guide.

Socket.IO currently emits only a `server:ready` protocol event. Connections have no player identity, seat or game authority. Future room commands and permission checks belong to Milestone 4 onward. Guest draft/theme storage and future-option media controls must follow the supplied project requirements.

## SQLite and Docker foundation

The locked `better-sqlite3` 13.0.3 package supports Node 22+ and ships native prebuilds, including Windows x64 and Linux glibc. Its SQLite 3.53.4 binding was exercised on Windows with Node 24.22.1. No C++ build tools were needed here. `package.json` explicitly denies its unnecessary install script: a clean npm install otherwise inferred `node-gyp rebuild` from the bundled source. The reviewed esbuild 0.28.2 install script is allowed. These policies require the documented npm version. A source-build fallback would require Python 3 and Visual Studio Build Tools with Desktop development with C++ on Windows, or Python 3, make and g++ on Debian, plus a deliberate script-policy change. Use the package's build instructions if a prebuilt binary is unavailable; do not replace the database driver or install global toolchains silently. Dependency decisions and primary references are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

`Dockerfile` is a multi-stage **foundation**, using Debian Bookworm Node 24.22.1, a production-only dependency stage and non-root `node` (UID/GID 1000). `/data` is owned by that user. Its build context excludes local secrets, databases and `.tools`. Container execution has not been verified: the installed Docker CLI cannot reach a running daemon. Full container persistence, Linux CI, backup/restore and Coolify verification are Milestone 9.

Once Docker Desktop is running, the optional foundation check is:

```powershell
docker build -t bid-and-build:m1 .
docker volume create bid-and-build-m1-data
# Create ignored .env.docker with APP_ORIGIN=http://localhost:3000
# and a separate random SESSION_SECRET (at least 64 characters).
docker run --rm --name bid-and-build-m1 --env-file .env.docker -p 127.0.0.1:3000:3000 -v bid-and-build-m1-data:/data bid-and-build:m1
```

Use one process/replica and stop the old container before starting a replacement. Do not publish or deploy before the requested review checkpoints. The supplied [Coolify guide](docs/COOLIFY-SETUP.md) describes the later completed application; administrator commands in that guide are not available in Milestone 1.
