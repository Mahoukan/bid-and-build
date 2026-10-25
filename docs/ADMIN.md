# Administrator template collection

Milestone 7 adds permanent templates without requiring guest accounts. `/admin` manages the collection; `/templates` shows public previews and hosts a fresh game. Administrator permission never grants a game seat, host controls or money changes. Private game codes recover only the original player seat, including its existing host permission.

## Create your real administrator privately

There is no default account, public signup or HTTP password-reset endpoint. The browser tests create a clearly labelled account only in an automatically allocated temporary database. Codex has not created an account in your application data.

In a **private interactive terminal**, from the repository root on Windows:

```powershell
# Select the tested local Node 24 installation on this machine:
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH"
npm.cmd run build
npm.cmd run admin:create
```

On another machine, select Node 24 LTS and npm 11.19.1–11.x first. Use `npm` on Linux/macOS. A fresh checkout needs `npm ci` and `npm run setup` before building. Keep the generated root `.env` private.

The command privately prompts for a username, password and repeated password. Input is hidden, including the username; no dots or characters appear. Enter or paste each value at its own prompt and press Enter. Usernames are case-insensitive, 3–64 characters, begin with a letter/digit, and allow letters, digits, `.`, `_`, `-`. Passwords are 15–128 characters and preserve spaces. Ctrl+C or Escape cancels. Never put credentials in arguments, environment variables, scripts, chat or shell history. Pipes are rejected.

The CLI and app resolve the same project-root `.env`; existing process environment overrides it. Both use the configured `DATA_DIR` and its `bid-and-build.sqlite`. Creation does not require a game or restart, and does not change player state. An existing username is rejected instead of overwritten. Confirm that this terminal has the intended `DATA_DIR`; a separate environment can point to a separate database.

Run `npm.cmd run dev`, then sign in at **http://localhost:5173/admin**. Create a template, fill all option titles, Save, then Publish. Public browsing is at **http://localhost:5173/templates**. The guest builder at `/builder` continues to store drafts only in that browser.

## Reset one administrator

```powershell
npm.cmd run admin:reset-password
```

Enter the exact username, new password twice, then `RESET` at the final hidden confirmation. Only that account's password changes; all its existing sessions are revoked. Other administrators, game credentials, rooms and ledgers are untouched. A missing account or failed confirmation changes nothing. Build again after application updates before running either CLI command. Login rate limits still apply after a reset; wait for their 15-minute window if needed.

## Production container

The compiled CLI is included in `dist/server/cli/admin.js`, uses production dependencies and Node built-ins, and requires neither `tsx` nor TypeScript at runtime. The existing Dockerfile copies it with `dist` and preserves both npm scripts. After the app container is running with the correct persistent `/data` mount and environment, open an interactive terminal in it (replace `YOUR_APP_CONTAINER`):

```text
docker exec -it YOUR_APP_CONTAINER npm run admin:create
docker exec -it YOUR_APP_CONTAINER npm run admin:reset-password
```

Use a private local terminal; these commands need a TTY. They inherit the container's environment and write its mounted database as the app's `node` user. No credential is part of either command line. Account creation/reset can run while games are active. Use one app process/replica, persistent `/data`, a stable `SESSION_SECRET`, and stop the old app before replacing it.

Production cookies are Secure and require the deployed **HTTPS** origin. `APP_ORIGIN` must match the browser's exact origin without a path/trailing slash. The built local preview supports localhost HTTP through browsers' localhost handling; a remote HTTP/LAN address is not a production-admin substitute. Docker/Linux/Coolify execution is still unverified here and belongs to the later deployment checkpoint; compiled commands were exercised on Windows Node 24 with isolated data.

## Editing and visibility

The admin editor reuses the builder's settings, option order/drag controls, image processing and validation. Save is explicit. New/duplicated templates start unpublished. Publishing/unpublishing requires saved changes. Saving an already published template updates the catalogue for future rooms. Deletes require confirmation. All writes include the current revision; a competing edit returns a conflict and preserves the current tab's unsaved contents. Reload deliberately discards those edits. The browser warns before leaving with unsaved changes. If the session expires, sign back in to continue with the in-memory editor; refresh does not save it.

Guest previews contain only template ID, title, description, cover URL and option count. The title, description and cover are intentionally public: do not put spoilers in those fields. No option texts, IDs, images or order are returned. Public cover routes require a currently published template. There is no public full-template or arbitrary asset route. Hosting resolves the published template on the server, creates a temporary independent snapshot, and gives the guest the host's ordinary playing seat. The browser's saved request key safely retries a lost hosting response, even if the source was subsequently edited, unpublished or deleted.

Each template and room owns separate image BLOBs with foreign-key ownership. Edits/deletes remove only that template's old assets in the same transaction. Active-room copies survive, and room expiry removes only room-owned copies. Duplicating a template also creates independent assets. This costs storage per copy but avoids shared-reference deletion errors. Assets are served through permission-checked routes, never a public upload directory or caller-supplied filesystem path. SQLite may retain freed pages for reuse after deletion.

Images accept still PNG/JPEG only. The browser checks 5 MiB source size, 20 MP and 8192 pixels per side, resizes to 1600 pixels, and strips metadata. The portable/API boundary independently enforces PNG/JPEG bytes, dimensions up to 1600, 1 MiB per image and 8 MiB combined; request JSON is at most 12 MiB. The server decodes and re-encodes with Sharp and checks output limits before a transaction can commit. HTML, SVG, multi-page images detected by the decoder, remote URLs, arbitrary paths and malformed/oversized images are rejected. Template text is rendered as plain text. The collection holds at most 500 templates; public pages contain 24 previews.

## Session and request protections

Passwords use the stable Node `crypto.scrypt` API with a fresh 128-bit salt and `N=131072, r=8, p=1` (about 128 MiB working memory, 160 MiB explicit ceiling). The asynchronous login path permits two simultaneous password derivations. This follows the [OWASP scrypt baseline](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [Node's scrypt interface](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback). The versioned stored hash permits a deliberate future upgrade. Unknown accounts do the same derivation and return the same login error. No authentication dependency was installed for this milestone.

Random 256-bit session tokens exist in HttpOnly cookies; only their SHA-256 verifiers are in SQLite. Production uses the host-only `__Host-bid_build_admin` cookie with Secure, HttpOnly, SameSite=Strict and Path=/; development/test uses `bid_build_admin`. Sessions survive process restart, expire after 12 hours absolutely or two hours idle, and are revoked on logout/reset. At most ten active sessions per account are retained. Every management route checks the current account permission, including reads; writes additionally require exact Origin, JSON content type and a session-bound CSRF header. Image writes recheck authority after decoding and before committing. The CSRF token stays in browser memory, not localStorage or URLs.

Login limits persist in SQLite: 20 attempts/IP and ten per normalized account per 15 minutes. Other catalogue/admin traffic is bounded separately (3000 GETs or 100 other requests/IP/minute; ten catalogue hosts/IP/minute), and the limit table is bounded/expired. Forwarded IP headers are not trusted. Behind a reverse proxy, clients can share the proxy's IP limit; do not enable unrestricted proxy trust to bypass this. Game recovery retains its separate M6 limits. Database credentials, cookie tokens and recovery codes must stay out of Git and logs.

## Verification and owner check

`npm run check`, `npm test`, `npm run build` and `npm run test:e2e` run the checks. `npm run test:e2e -- tests/e2e/admin.spec.ts` focuses on this milestone. Set `CHROME_PATH` to installed Chrome or install Playwright Chromium. Tests use temporary databases and browser contexts, never the owner's data or personal profile. The suite includes session expiry/restart/logout/reset, direct-route authorization, CSRF/origin checks, login limits, immutable room assets, transaction rollback, concurrent revisions, metadata removal, hostile image rejection, guest hosting and ordinary admin-as-player permissions. See PROGRESS.md for results actually observed.

Create your actual account with the private CLI. Publish a template with at least two pictured options. In another browser profile, host it from `/templates`; invite one other player and Start. Edit, unpublish and delete the source in the admin tab, then continue playing. The room must keep its original options/images and money. Check sign-out and reset on your own machine. Real phone keyboards/touch, Safari/Firefox, screen readers and the production container still require manual checks.
