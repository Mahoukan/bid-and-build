# GitHub and Coolify deployment

Reconciled with the implemented Milestone 9 runtime on 25 October 2026. Complete the local acceptance checks and require a green Linux CI run before deployment. Local Windows checks passed; Docker/Linux execution and actual Coolify/HTTPS deployment remain unverified. No site has been deployed by Codex.

**1. Prepare the repository**

Review the files in VS Code Source Control. Commit the app, tests, package-lock.json, Dockerfile, .dockerignore, .env.example and project documentation. The supplied .gitignore excludes .env, data, uploaded files and database sidecars. Confirm that Git's tracked files do not contain those assets; an ignore rule does not remove an already-tracked secret.

Use VS Code's Publish to GitHub action, or push to your existing intended repository. Choose a private `bid-and-build` repository initially. Connect it to Coolify through the GitHub integration or a deploy key with access to that repository. Keep manual deployments during development. The app does not need a GitHub Pages deployment.

**2. Optional local production/container test**

Start Docker Desktop in Linux-container mode and run this in the project root:

```powershell
docker build -t bid-and-build:local .
npm.cmd run test:docker -- bid-and-build:local
docker volume create bid-and-build-test-data
```

Create an ignored `.env.docker` file locally. Use these fields, replacing the secret:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATA_DIR=/data
APP_ORIGIN=http://localhost:3000
SESSION_SECRET=REPLACE_WITH_A_RANDOM_SECRET
```

Generate the secret locally with Node and paste it into that file; do not paste it into a chat or commit it:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Run the container in a foreground terminal:

```powershell
docker run --rm --name bid-and-build-local --stop-timeout 30 --env-file .env.docker -p 127.0.0.1:3000:3000 -v bid-and-build-test-data:/data bid-and-build:local
```

Visit http://localhost:3000 and /health. In a second terminal, create a test admin:

```powershell
docker exec -it bid-and-build-local npm run admin:create
```

Production cookies should be Secure. A plain HTTP local container can verify readiness/assets but is not a complete HTTPS admin/session test. Use a local HTTPS reverse proxy or the HTTPS staging domain for the full production authentication check; keep production cookie protections enabled. Do not add a production cookie bypass merely to make this HTTP check pass.

The admin CLI creates a database record suitable for an initial persistence check. Stop the container with Ctrl+C, then run the same command again; recreating the same username should be rejected because the account still exists. Use the HTTPS session to verify template/image and active-game restoration as well. Never add a public test/setup endpoint for this check. This test volume is disposable test storage; do not remove a volume that contains something you want to retain.

**3. Create the Coolify application**

In your existing Coolify project/environment, add an application from the GitHub repository. Choose the Dockerfile build method. The repository root is the build context.

| Setting | Value |
| --- | --- |
| Repository | Your bid-and-build repository |
| Branch | main, unless you deliberately use another deployment branch |
| Base directory | Repository root (`/`) |
| Dockerfile | Dockerfile at the repository root |
| Internal/exposed port | 3000 |
| Instance count | 1 |
| Public domain | Your chosen HTTPS subdomain |
| Health route | /health on internal port 3000 |
| Stop grace period | 30 seconds; application emergency deadline is 25 seconds |

The app must listen on 0.0.0.0 inside the container. Coolify's proxy should reach that internal port; you do not need an extra public host port mapping. Use the existing DNS/reverse-proxy arrangement for your server and point the chosen domain at the route you intend to use. Verify HTTPS before testing admin sessions and phone play. The exact DNS record depends on your existing networking setup.

**4. Set runtime environment variables**

Set these in Coolify's application environment configuration:

| Name | Production value |
| --- | --- |
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| PORT | 3000 |
| DATA_DIR | /data |
| APP_ORIGIN | Your actual HTTPS origin, e.g. https://bid.your-domain.example, with no trailing slash |
| SESSION_SECRET | A newly generated long random secret, kept stable across redeploys |
| TRUST_PROXY | Actual proxy IP(s)/CIDR(s), comma-separated; otherwise empty (all forwarded IPs ignored) |

The example domain is a placeholder. Generate a separate production SESSION_SECRET using the local Node command above. These are runtime settings; keep secret values out of build arguments, Dockerfile layers, client-side Vite variables and the repository. Root .env is for local work; the production environment comes from Coolify.

Do not change SESSION_SECRET on every release: sessions may be invalidated. Document any deliberate secret rotation. Administrator passwords are created interactively later and do not need to live in environment variables.

Only trust the actual Coolify proxy's addresses/network, after checking its Docker network configuration. Do not guess a subnet, trust all addresses, or use a hop count. Restrict backend access to that proxy and make sure it supplies/sanitises forwarding headers. Empty TRUST_PROXY is safe but rate limits then group requests by the proxy address, so several users can share one limit. Production Secure cookies do not depend on forwarded headers. See [Express proxy configuration](https://expressjs.com/en/guide/behind-proxies/) for why the trust boundary matters.

**5. Attach persistent storage before first use**

Add a named volume mounted at `/data`. That directory holds `bid-and-build.sqlite` and its WAL/SHM sidecars. Content images are BLOBs inside the database, so templates, room snapshots and images persist together. Mounting a different directory will not preserve files written to /data.

A bind-mounted directory such as `/opt/appdata/bid-and-build` is an alternative if you prefer managing the files directly. Create only that application directory and give it ownership **1000:1000**, the image's non-root `node` UID/GID. Do not recursively change permissions on unrelated app folders. A new named volume inherits the image's owned `/data`; an existing/bind-mounted directory may need an operator to correct its ownership before startup.

Use separate storage for previews, staging and local tests. Only one app instance may manage a given live room database. Confirm the running app can write its mount before creating valuable templates.

**6. Prevent overlapping app instances during updates**

This app keeps a live room engine in one process. An overlapping rollout could create two independent engines even though SQLite serialises individual writes.

In Coolify's container naming settings, select **Consistent name (no rolling updates)** when available. A unique Custom Container Name is another documented way to force the old container to stop first. Verify the deployment log confirms the stop-before-start sequence. Use one replica and deploy between games; a brief interruption is expected.

Keep automatic deployments off until you are comfortable with that workflow. This is a deliberate single-instance deployment; do not enable clustering or start a second instance against the same volume. See the linked rolling-update documentation for version-specific settings.

**7. Deploy and create the production admin**

Deploy, read the build/runtime logs, check /health and open the HTTPS site. Startup migrations must finish before readiness succeeds. If it fails, use the real error to fix the build or configuration rather than clearing the database.

Open an interactive terminal in the running application container using Coolify and run:

```sh
npm run admin:create
```

Enter the administrator credentials privately. This creates the account in the production /data database. Visit /admin on the HTTPS domain and log in. `npm run admin:reset-password` resets one named account and revokes its sessions. Both commands are compiled into the image and use production dependencies. `npm run db:migrate`, `db:backup` and `db:restore` are also included; startup already runs migrations before readiness. See [ADMIN.md](ADMIN.md) for private prompts and restrictions.

Publish a template, host it as a guest from another browser, and complete a small game. Test at least two actual devices, a private-code recovery and a display connection. Full five-player and visual checks can use separate browser contexts as well.

**8. Verify redeploy and backups**

Create a test template and purchase, then redeploy using the same persistent mount. Confirm the template/image survives and the active game can recover paused without repeated charges. The log should show the old app stopped before the replacement became active.

Use `docker exec YOUR_CONTAINER npm run db:backup -- /data/backup-NEW_NAME`, then copy that complete backup directory to protected off-server storage. The online SQLite backup includes content-image BLOBs, verifies integrity and writes a checksum manifest. `npm run db:restore -- BACKUP_DIR NEW_DATA_DIR` refuses overwrite and verifies the separate restored database. Alternatively stop every writer before archiving the complete DATA_DIR. Do not copy a live database file alone. Follow [BACKUP-RESTORE.md](BACKUP-RESTORE.md), retaining the matching secret and application version privately. Local isolated restore has been verified; rehearse your actual volume restore before relying on it.

Before a schema-changing update, take a backup. Reverting an application image does not automatically revert a database migration. Use the documented migration/restore process if rollback is needed.

**9. Later updates**

Make changes in VS Code, run relevant checks, commit, push and manually deploy when no game is active. Retain the same mount, domain and stable session secret. Verify health and a short join/bid/reconnect flow after deployment. Application code belongs in Git; live templates/images and game state belong in the persistent data directory.

References checked for this handoff: [Coolify Dockerfile](https://coolify.io/docs/applications/builds/dockerfile), [persistent storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview), [rolling updates and stop grace period](https://coolify.io/docs/applications/deployments/rolling-updates). These document the deployment configuration; they are not evidence that this application has been deployed.
