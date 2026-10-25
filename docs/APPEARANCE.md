# Local appearance and fitted gameplay

Open **Appearance** in the site header, **Game menu → Appearance** while playing, or the shared display's header. All controls live in the same panel. Choose Minimal, Glass, Neon or Paper, then adjust light/dark mode, accent colour, a local background image and glass surfaces.

Changes preview immediately across the page. **Save appearance** persists them in this browser. Closing the panel discards unsaved changes; changing a preset keeps the selected background. **Reset to Defaults** immediately saves Minimal/light/green without a background or glass. Reset leaves local drafts, player credentials, recovery codes, pending room requests and administrator sessions intact. Appearance does not pause or change a running auction.

Minimal is the simple green default. Glass starts with light blue and translucent panels. Neon starts dark with a purple accent and restrained glow. Paper uses warmer surfaces and a small card shadow. Individual controls can override a preset. Essential controls, typography and panel dimensions stay in the same positions across themes.

## Browser storage and privacy

Small, validated version-1 preferences use the single localStorage key `bid-build.appearance.v1`. A personal background is a PNG Blob in a separate IndexedDB database, `bid-build-appearance`, referenced by an opaque local ID. The draft database is not used. No appearance record, image, URL or preference is sent to the server, included in room commands or copied into template JSON exports. This also applies when hosting a guest draft: only its game content is uploaded.

Background selection accepts PNG or JPEG up to 5 MiB, 20 megapixels and 8192 pixels per side. The existing local image processor checks the actual bytes, decodes, resizes to at most 1600 pixels and re-encodes a PNG no larger than 1 MiB. SVG, arbitrary remote URLs, oversized and undecodable images are rejected. Re-encoding strips metadata. The original image and temporary preview stay in browser memory; saved bytes enter IndexedDB only on Save. Display URLs are browser-generated Blob URLs and are revoked when replaced.

The image transaction must commit before the localStorage reference is saved. A failed preference write leaves the previous saved appearance intact and attempts to remove the new unused image. Successful replacement/removal cleans up only the previous image ID; it never clears a database or another tab's staged image. Reset reports if the browser could not finish removing unused bytes. An interrupted process or storage-denied cleanup can leave an unreferenced local image; it is not served or uploaded. Missing/corrupt saved data shows an explicit fallback notice and can be replaced or reset without touching drafts or identity.

Quota/permission failures retain the in-memory preview and display an error instead of claiming success. Same-origin tabs receive storage updates; an editor opened against an older saved value rejects a stale save and asks you to close/reopen the panel. Separate browser profiles, origins and devices have independent preferences. Moving a seat with a private recovery code retains the destination device's appearance. The separately opened shared display uses its own browser settings; ordinary screen mirroring mirrors the source browser instead.

## Readability and layout

Shared tokens style home, builder, administrator forms, room entry, gameplay, results and dialogs. The chosen accent remains visible in the picker, while its rendered control colour is adjusted toward a readable shade. The algorithm targets at least 7:1 against solid surfaces; button text chooses white or black. Tests also check at least 4.5:1 for text over worst-case black/white photography through the actual overlay and glass alpha. Danger, success, muted text and focus colours remain independent of the accent. Status is expressed in words as well as colour.

Backgrounds use an 88% palette-coloured overlay. Glass surfaces use 92% opacity and blur only when supported; unsupported blur and `prefers-reduced-transparency` use opaque surfaces. The panel includes a clear thumbnail before the overlay. `prefers-reduced-motion` disables animation, transitions and smooth scrolling. Forced-colour mode removes decorative background imagery/glow and preserves selection outlines.

The two existing game compositions remain fitted at **360×640**, **390×844**, **1280×720** and **1440×900** browser-content sizes. Milestone 10 shows acquired builds/results together with bounded vertical collection scrolling; details and bid history retain paging. All player balances, own balance, the current option, leading bid and main actions remain visible. Appearance stays in a compact modal rather than adding a permanent player toolbar. Dialog bodies may scroll; their header/footer actions remain reachable with reduced keyboard space. Builder/admin pages intentionally scroll.

At unusually short landscape windows or accessibility zoom, vertical reflow is allowed so controls remain reachable. Browser zoom is not disabled, and overflowing controls are not hidden to manufacture a fit. Phone browser bars, safe areas and real OS keyboards still need device verification.

## Checks and review

With Node 24 selected:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm.cmd run test:e2e
# Focused appearance checks:
npm.cmd run test:e2e -- tests/e2e/appearance.spec.ts
```

Tests use isolated browser contexts and temporary databases. Contrast tests sample the colour gamut in every preset and both modes. Browser checks cover persistence, cancelled previews, profile isolation, same-origin stale edits, image/JSON validation, IndexedDB/localStorage failure handling, cleanup, reset retention, absence of theme data from exports/HTTP/socket payloads, and recovery/display independence. The gameplay matrix applies all presets with a custom accent, background and glass for 2/3/5 players through lobby, bidding, pause, reveal and results at all four target sizes, checking control bounds/clickability as well as overflow. Existing description/history pagination and auction/recovery tests run alongside it. See PROGRESS.md for actual outcomes and screenshot locations.

Manual review: host and join in separate profiles. Change one browser's preset, accent and background, save and refresh; the other player must look unchanged. Resume as host after the refresh pause. Open a shared display and try its own Appearance panel. Reset one browser and confirm its seat, purchases and saved local drafts remain. Repeat on a real phone with keyboard, rotation, zoom and browser bars. Safari/Firefox, screen readers, TV mirroring and production Docker/Coolify remain separate manual/deployment checks.
