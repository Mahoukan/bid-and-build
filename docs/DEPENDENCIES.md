# Milestone 1 dependency decisions

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
