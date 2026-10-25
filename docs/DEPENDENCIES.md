# Dependency decisions

Checked 22 October 2026 using the npm registry's published version, engine and peer-dependency metadata, plus the official sources below. Exact direct versions are in `package.json`; all resolved versions are pinned by the single root `package-lock.json`. Use npm >=11.19.1 <12 and Node 24, not a second package manager.

| Component | Selected version | Reason |
| --- | --- | --- |
| Node / npm (Windows tested) | 24.22.1 / 11.19.1 | Required Node 24 LTS; portable archive verified against official SHA-256 |
| React / React DOM | 19.3.1 | Current matching stable releases |
| React Router DOM | 7.18.4 | Client navigation and direct route shells; Node 20+ |
| Vite / React plugin | 8.3.5 / 6.1.2 | Compatible Vite 8 peer range and Node 24 engines |
| Express | 5.3.0 | Maintained major, Node 18+ |
| Socket.IO / test client | 4.8.4 | Same protocol version on both sides |
| better-sqlite3 | 13.0.3 | Node 22+, bundled native prebuilds and synchronous transactions |
| Zod | 4.6.7 | Runtime validation shared across TypeScript boundaries |
| TypeScript | 6.0.3 | Highest supported 6.0 release; typescript-eslint 8.72.0 requires TypeScript <6.1, so 7.0.2 was not selected |
| ESLint / typescript-eslint | 10.13.0 / 8.72.0 | Compatible peer ranges |
| Vitest | 5.0.5 | Supports Node 24 and runs real runtime smoke tests |

`tsx` and `concurrently` provide cross-platform watched development. No global dependencies or runtime downloads are required after installation. Native packages must be installed for the target platform; Windows `node_modules` is never copied into Docker.

Clean-install verification exposed npm inferring an unwanted `node-gyp rebuild` for better-sqlite3 despite the tarball's `gypfile: false` and bundled prebuilds. The root `allowScripts` policy explicitly denies better-sqlite3 lifecycle scripts and permits the reviewed esbuild 0.28.2 script. This removes the unnecessary compiler requirement. npm's installed 11.19.1 documentation and implementation were inspected to confirm this policy; the minimum npm engine is enforced so older clients do not ignore it.

Primary sources:

- [Node release schedule](https://nodejs.org/en/about/previous-releases)
- [Node 24.22.1 archives and checksums](https://nodejs.org/dist/v24.22.1/)
- [Vite prerequisites](https://vite.dev/guide/)
- [better-sqlite3 repository and installation](https://github.com/WiseLibs/better-sqlite3)
- [Package registry metadata](https://registry.npmjs.org/typescript-eslint/8.72.0)

The initial install reported zero known vulnerabilities. This is a point-in-time package audit, not an application security audit. Verify updated packages and rerun checks deliberately when upgrading.

## Milestone 4 additions (24 October 2026)

`sharp` **0.35.5** was checked against npm's published engine and optional-dependency metadata before installation. It requires Node >=20.9.0 and supplies native packages for Windows x64 and Linux x64/glibc; Debian Bookworm satisfies the documented glibc baseline. See [Sharp's official installation requirements](https://sharp.pixelplumbing.com/install/). Native PNG/JPEG decoding and PNG encoding passed under the project's Node 24.22.1 on Windows x64. The root lockfile includes both Windows and Linux x64 Sharp/libvips packages; container execution is still a separate unverified check. Do not omit optional dependencies or reuse one platform's node_modules on another. A native source-build fallback needs a compatible C++ toolchain, node-gyp/node-addon-api and libvips per Sharp's installation guide; no global toolchain was installed here.

`socket.io-client` **4.8.4**, already used by integration tests, moved into production dependencies for the browser room client. npm reports its engine as Node >=10, compatible with the project's Node 24. Exact direct versions and all resolved dependencies remain in the one root lockfile. `npm install --save-prod --save-exact sharp@0.35.5 socket.io-client@4.8.4` reported zero known vulnerabilities at installation time; this is not a security audit of the application.

## Milestone 5 additions (24 October 2026)

Registry metadata was checked before installing `@playwright/test` **1.64.1** (Node >=20), `qrcode` **1.5.4** (Node >=10.13.0) and `@types/qrcode` **1.5.6**. All support the selected Node 24 toolchain and are pinned in the root lockfile. Playwright and the QR types are development dependencies; `qrcode` produces lobby invitation QR codes locally in the browser. No external QR service receives invite data.

The tests use the installed Chrome executable through `CHROME_PATH`, fresh contexts and an isolated real production server. Other machines can install Playwright's Chromium; see [README checks](../README.md#commands-and-checks). Docker's runtime dependency stage omits Playwright and browser binaries. Both npm installations reported zero known vulnerabilities at install time. This does not replace application or deployment security review.

## Milestone 7 authentication (24 October 2026)

No packages or lockfile entries were added for M7. Password hashing uses stable built-in Node 24 `crypto.scrypt` with an independently random salt and the OWASP `N=2^17, r=8, p=1` baseline. The compiled CLI uses only production dependencies and Node built-ins. See [administrator setup and security parameters](ADMIN.md). Existing Sharp processing is shared by guest room snapshots and permanent template storage.

## Milestone 9 packaging (25 October 2026)

No application dependencies or lockfile resolutions changed. Docker explicitly installs npm 11.19.1 in its Node 24.22.1 Debian base so the allowScripts policy is applied in both clean dependency stages. Production retains better-sqlite3 and Sharp, omits dev dependencies, and includes compiled maintenance commands. Clean Windows install passed from the unchanged lockfile; the first offline attempt lacked a cached tarball and the subsequent network-enabled isolated install passed. The Ubuntu CI job checks a fresh native install/build and runs the actual Linux image/persistence smoke. Linux/container execution remains unverified locally until a daemon is available. CI follows the official [setup-node example](https://github.com/actions/setup-node) and [Playwright CI guidance](https://playwright.dev/docs/ci-intro); no deployment credentials are used.

## Milestone 10 LAN HTTP correction (25 October 2026)

Added exact `@noble/hashes` **2.4.0**, with the root lockfile updated. Registry engine/export metadata was checked before installation: Node >=20.19.0, compatible with Node 24.22.1; no runtime dependencies or native build step. Only its SHA-256 implementation is imported into the browser request helper. See the [official noble-hashes repository](https://github.com/paulmillr/noble-hashes).

The previous retry fingerprint called `crypto.subtle.digest`, which is [restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle) and absent on ordinary LAN HTTP. The replacement retains the identical UTF-8/SHA-256/lowercase-hex fingerprint so existing pending requests remain retryable. Random request capabilities still use [`crypto.getRandomValues`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues), which works on insecure origins. Tests compare fingerprints with Node's SHA-256 and exercise lost responses without duplicate rooms/seats.

`npm audit --json` on this date reported one existing high-severity advisory in transitive `body-parser` 2.3.0: [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), compressed-body denial of service, fixed in 2.4.0. It is unrelated to the new hashing package. No broad dependency upgrade was included in this focused LAN correction; the advisory remains a separate dependency-maintenance item. Earlier zero-vulnerability results above are historical.
