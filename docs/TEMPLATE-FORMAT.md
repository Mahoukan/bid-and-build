# Local drafts and portable templates

Milestone 3 added the browser-local builder. Editing, saving and importing remain entirely local. Milestone 4 now adds explicit hosting of a temporary server room snapshot; see `MULTIPLAYER.md`. Permanent server templates remain a later milestone. The selectable starter is the repository's unchanged `samples/dragon-game.json`. Selecting it creates an unsaved local copy; it never silently populates the draft library.

## Portable JSON version 1

The shared validator is `shared/template.ts`. Exports preserve the sample's core keys:

```json
{
  "format": "bid-and-build-template",
  "version": 1,
  "title": "Build Your Perfect Dragon",
  "description": "",
  "coverImage": null,
  "startingCurrency": 20,
  "currencySymbol": "$",
  "minimumOpeningBid": 1,
  "minimumBidIncrease": 1,
  "options": [
    { "id": "firebreathing", "title": "Firebreathing", "description": "", "image": null }
  ]
}
```

Unknown keys and unsupported format/version values are rejected. Titles are trimmed, required and limited to 120 characters; descriptions are optional strings up to 4,000 characters. Currency settings use the same shared positive whole-number rules as the engine: 1–1,000,000, starting currency at least the opening price, and a trimmed 1–8 character symbol. Numbers encoded as strings, fractional numbers, unsafe numbers and nonfinite values are invalid.

There must be 1–200 options. IDs are unique, 1–64 ASCII letters, digits, underscores or hyphens. Import/export preserves IDs and array order. Adding or duplicating an option creates a random UUID; reordering leaves IDs and content intact. Plain text resembling HTML stays text when rendered; there is no HTML renderer or remote-image URL field.

An absent image is exactly `null`. An image is an object with its own representation version:

```text
{ "version": 1, "mimeType": "image/png", "data": "<padded standard base64 bytes>" }
```

The portable validator accepts `image/png` and `image/jpeg`. `data` contains bytes only, without a `data:` prefix, whitespace, URL, path or blob reference. It validates canonical base64, byte limits, MIME/header agreement and dimensions. Header validation alone does not prove that an image decodes: browser imports additionally decode and re-encode every image before replacing the editor. Milestone 4 hosting independently validates and re-encodes images with Sharp on the server; the shared schema alone is not that server boundary. See `MULTIPLAYER.md` for protected room media and storage.

## Image and file limits

| Boundary | Limit |
| --- | --- |
| Selected source image | PNG or JPEG; 5 MiB maximum |
| Source dimensions | At most 20,000,000 pixels and 8,192 pixels per side |
| Portable image | At most 1 MiB of decoded image-file bytes and 1,600 pixels per side |
| All images in one template | At most 8 MiB of decoded image-file bytes, counting each occurrence |
| Complete JSON file | At most 12 MiB of UTF-8 bytes |

Source headers are checked before browser decoding. The image is fitted within 1,600 × 1,600 without upscaling, drawn to a canvas and encoded as PNG. PNG keeps transparency and avoids accumulating JPEG loss across exports/imports. Images over 1 MiB are resized further until they fit; the original source file is never modified. Source metadata and animation are not retained. JPEG inputs become PNG. Importing already normalized builder images retains their pixels; the automated Chromium check also verifies exact encoded-byte round trips for its generated fixture. Different browser encoders may produce different PNG bytes for identical pixels.

Processing occurs sequentially during import to bound decoded memory. SVG, GIF, WebP, executable HTML and remote paths/URLs are unsupported. File extension alone is not trusted. A corrupt image or invalid import leaves the existing editor intact. If an image would exceed the collection limit, its replacement is rejected and the previous image remains.

## Local persistence and editing

IndexedDB database `bid-and-build-local`, version 1, contains `drafts` and `meta` stores. Each saved record has a local UUID, a separate 1–120 character draft name, the complete validated portable template, a revision and an updated timestamp. `meta.lastDraft` identifies the last successfully saved or loaded draft for refresh. The database contains actual base64 image bytes, never expiring object URLs. Draft names, local IDs, timestamps and revisions are not exported; game fields and images are.

Save is explicit; there is no background autosave or upload. Incomplete fields can be edited but must be corrected before saving/exporting. **Saved to this browser** appears only after a successful IndexedDB transaction. **Save as copy** duplicates the current editor into a new saved record; to duplicate a library entry, load it first. Deleting a saved record requires confirmation and keeps the open editor so it can be exported or saved again. Loading/starting/importing over unsaved edits asks before discarding them. Leaving the route or closing/reloading with edits also prompts, subject to the browser's usual unload-dialog rules.

Save, revision comparison and last-draft selection commit together. A save from a stale tab fails instead of overwriting another tab's revision. The user can export, reload, or save a new copy. Quota, blocked/disabled storage, failed transactions and conflicting writes show errors without clearing edits or claiming success. The builder can still export valid designs when browser storage is unavailable. Export starts a browser download; it does not claim that the file has been saved to disk.

Local drafts belong to the browser profile and origin (scheme, host and port). `localhost:5173`, `localhost:3000`, a LAN address and a deployed domain have separate stores. Clearing site data can remove drafts. Export JSON to back them up or move them. Draft storage is separate from future personal appearance and player identity storage. No appearance preferences, background images, admin sessions or recovery credentials enter template files.

## Verification

`npm test` covers schema rejection, limits, ordering/IDs, image representation and JSON round trips. The optional browser check uses the installed Chrome/Chromium with new profiles under ignored `.cache/browser-m3/`; it never touches the owner's browser profile or server data. Start the development server, then in a second terminal:

```powershell
$env:PATH = "$PWD\.tools\node-v24.22.1-win-x64;$env:PATH" # only on this prepared machine
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/check-builder-browser.mjs
```

On Linux/macOS, select Node 24 normally and pass `CHROME_PATH=/path/to/chromium node scripts/check-builder-browser.mjs`. `BUILDER_ORIGIN` optionally overrides `http://localhost:5173`; this script requires Vite because some boundary checks import source modules. It tests actual IndexedDB persistence, native file selection, real canvas processing, downloads and import in a second isolated profile, save conflicts, injected quota exhaustion, validation, text escaping, navigation protection, keyboard reordering, four viewport widths and no network writes. Screenshots and exported fixtures are left in the ignored run directory for inspection. Gameplay E2E coverage remains a later milestone.

Manual check: select the dragon starter, edit it, upload an image, Save, refresh, Export JSON, then import in another browser/profile. Confirm fields, order and images survive. Check keyboard navigation and image-viewer dismissal on your actual phone/browser. Host game now explicitly sends a temporary copy as described in `MULTIPLAYER.md`; local Save still sends nothing.
