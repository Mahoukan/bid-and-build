# Backup and restore

Use Node 24 and build first. The compiled commands use production dependencies and the same root `.env` / runtime environment as the server. They never overwrite an existing destination, even an empty directory. Paths supplied as arguments are relative to your current terminal directory; configured `DATA_DIR` is relative to the repository root. Parent directories must already exist.

## Consistent online backup

```powershell
npm.cmd run build
New-Item -ItemType Directory -Force backups | Out-Null
npm.cmd run db:backup -- ./backups/before-update-2026-10-25
```

Choose a new name for each backup. The app can remain running. This calls SQLite's online backup API, includes committed WAL transactions and verifies SQLite integrity, foreign keys and the exact migration history. `manifest.json` records format/version, schema version, time and a SHA-256 checksum. A successful backup directory contains `bid-and-build.sqlite` and that manifest.

All room and permanent-template content images are SQLite BLOBs. They are part of the same consistent snapshot as templates, accounts, sessions, rooms, recovery verifiers, command receipts and the purchase ledger. There is no separate upload directory to coordinate. Guest drafts and appearance backgrounds live in browsers and are not server backups: export important drafts from the builder.

The app's `SESSION_SECRET` and environment are deliberately excluded. Store those separately in your private secrets manager and retain the matching image/commit. Restoring with another secret breaks encrypted private retry receipts, display capabilities and admin CSRF values. Normal session lifetimes and the 24-hour room inactivity expiry still apply after restore; a backup is not a way to extend expired games.

Keep backups private: they contain account hashes, sessions, private game material and recovery data. The command requests private file/directory permissions; Windows access also depends on the parent ACL. Copy the complete successful backup directory to protected off-server storage. A volume on the same disk is not protection from disk/server loss. Retention/deletion is the owner's responsibility; the command never deletes old backups.

Do not copy a live `.sqlite` file alone or discard its WAL while the app is running. As a maintenance alternative, stop every writer (including admin/migration tools), archive the complete DATA_DIR with all sidecars, then restart. The verified manifest-based restore command below accepts backups produced by `db:backup`, not arbitrary directory archives. Do not start a server inside a backup directory or edit a backup.

## Restore into new storage

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
npm.cmd run db:restore -- ./backups/before-update-2026-10-25 ./.cache/data-restored-check
```

This validates the checksum, matching schema, SQLite integrity and foreign keys, copies into a new directory, and verifies the copy again. It never modifies the source backup, current DATA_DIR or an existing destination. A failed operation may leave a newly created incomplete directory; do not select it as DATA_DIR. Use a different new directory after fixing the cause. A checksum detects corruption, not a maliciously replaced backup; only restore your trusted copies.

For a local rehearsal in a separate terminal, keep the current server and its original storage unchanged:

```powershell
$env:DATA_DIR = "$PWD\.cache\data-restored-check"
$env:PORT = '3001'
$env:APP_ORIGIN = 'http://localhost:3001'
# Keep the same original SESSION_SECRET through .env/private configuration.
npm.cmd start
```

Open http://localhost:3001/health and the catalogue; verify images and a paused game using its private recovery code. This is separate restored storage, never a second server pointing at the original database. Verify the ledger, amounts and builds before resuming. Production admin sessions need HTTPS; this HTTP preview does not verify proxy/TLS behavior. Close the rehearsal terminal afterward so its environment overrides are not reused by accident. This example uses ignored `.cache/` for the rehearsal; never place restored private data in tracked storage.

Before using a restore for the live app, stop the old instance and all maintenance commands, select the restored DATA_DIR/mount, keep the matching secret, then start exactly one replacement. Never copy over the live database. Room startup automatically pauses interrupted bidding/reveals without charging purchases again. The host reconnects/recovers and explicitly resumes.

## Container commands

Use the actual container name. A backup path under `/data` persists across replacement, but must still be copied off-server:

```sh
docker exec bid-and-build-local npm run db:backup -- /data/backup-2026-10-25
docker cp bid-and-build-local:/data/backup-2026-10-25 ./backups/backup-2026-10-25
docker exec bid-and-build-local npm run db:restore -- /data/backup-2026-10-25 /data/restore-check-2026-10-25
```

The restore creates a separate directory only; it does not start another engine or switch the live app. For a production restore, select that new directory through the mount/DATA_DIR after stopping the old instance, or restore into a fresh volume with an operator-controlled maintenance container. Bind-mounted parents must be writable by UID/GID **1000:1000**. Do not change unrelated directory permissions or remove a live volume.

## Schema changes and verification

Startup applies new migrations transactionally. `npm run db:migrate` provides the same compiled migrations explicitly. Back up before upgrading; never edit an applied migration. Backup/restore requires this application's exact schema history. For rollback, use the matching old application and its pre-upgrade backup in new storage. Changing an image tag does not undo database migrations. Keep the original data until the rollback has been checked.

`npm test` verifies live WAL backup, independent template/room images, checksum/overwrite rejection and separate paused restore. `npm run test:production` exercises the compiled CLI against disposable storage, restarts the real server, checks sessions/recovery and verifies exactly one ledger charge. `npm run test:docker` performs that scenario through a disposable labelled named volume and verifies clean SIGTERM exits. These are rehearsal tools, not backups of your data.

Implementation reference: [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise). Deployment and storage details: [Coolify guide](COOLIFY-SETUP.md).
