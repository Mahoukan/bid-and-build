// Optional real-Chromium check for Milestone 3. Requires a running Vite dev
// server and CHROME_PATH. Uses fresh profiles only; never reads personal data.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const executable = process.env.CHROME_PATH;
if (!executable) throw new Error('Set CHROME_PATH to a local Chrome/Chromium executable. Start npm run dev first.');
const origin = process.env.BUILDER_ORIGIN ?? 'http://localhost:5173';
const root = resolve('.cache/browser-m3');
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'run-'));
const browsers = [];

async function browser() {
  const profile = await mkdtemp(join(output, 'profile-'));
  const process = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const pending = new Map();
  const errors = [];
  const writes = [];
  const dialogs = [];
  let acceptDialog = false;
  let nextId = 0;
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch { /* process may already have exited */ } }
    socket?.close(); process.kill();
    for (const item of pending.values()) clearTimeout(item.timer);
  };
  browsers.push({ close });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error('Isolated Chrome did not start. Check CHROME_PATH and execution permissions.');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  assert.ok(page);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push({ status: message.params.response.status, url: message.params.response.url });
    // React cleanup and page reload intentionally cancel in-flight requests.
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) errors.push({ networkError: message.params.errorText });
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params.request;
      if (request.url.startsWith(origin) && !['GET', 'HEAD'].includes(request.method)) writes.push({ method: request.method, url: request.url });
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params.message);
      void send('Page.handleJavaScriptDialog', { accept: acceptDialog });
      acceptDialog = false;
    }
    const item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result); }
  });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(75); }
    throw new Error(`Browser condition not met: ${expression}\n${await evaluate('document.body.innerText')}\nPage: ${await evaluate('location.href + " " + document.readyState')}\nBrowser errors: ${JSON.stringify(errors)}`);
  }
  async function loaded() { await until(`!!document.querySelector('#game-title') && ![...document.querySelectorAll('button')].find(b => b.textContent === 'Save draft')?.disabled`); }
  async function click(label) {
    assert.equal(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`), true, `Enabled button: ${label}`);
    await delay(40);
  }
  async function fill(id, value) {
    await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); })()`);
    await delay(40);
  }
  async function upload(id, file) {
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
    assert.ok(nodeId);
    await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    await loaded();
  }
  const saved = () => until(`document.querySelector('[data-save-state]')?.dataset.saveState === 'saved' && document.querySelector('[data-save-state]').textContent === 'Saved to this browser'`);
  async function records() {
    return evaluate(`new Promise((resolve, reject) => { const r = indexedDB.open('bid-and-build-local', 1); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const tx = db.transaction('drafts'); const q = tx.objectStore('drafts').getAll(); q.onsuccess = () => resolve(q.result); tx.oncomplete = () => db.close(); }; })`);
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.navigate', { url: `${origin}/builder` }); await loaded();
  return { send, evaluate, until, loaded, click, fill, upload, saved, records, errors, writes, dialogs, confirm: () => { acceptDialog = true; } };
}

try {
  const first = await browser();
  assert.equal((await first.records()).length, 0);
  await first.click('Save draft');
  await first.until(`!!document.getElementById('option-title-error')`);
  await first.click('Use dragon starter');
  const dragOrder = await first.evaluate(`(() => { const details = document.querySelector('.reorder-panel'); details.open = true; const items = details.querySelectorAll('li'); const source = items[0]; const target = items[1]; const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:transfer})); target.dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:transfer})); return source.dataset.optionId; })()`);
  await first.until(`document.querySelector('#option-picker').selectedIndex === 1`);
  assert.equal(await first.evaluate(`document.querySelector('#option-picker').value`), dragOrder);
  await first.click('Move up');
  await first.evaluate(`document.querySelector('.reorder-panel').open = false`);
  await first.fill('game-title', 'Portable dragons QA');
  await first.fill('draft-name', 'Browser QA original');
  await first.fill('game-description', '<img src=x onerror="window.injected=true"> Plain text only.');
  await first.fill('startingCurrency', 49);
  await first.fill('minimumOpeningBid', 2);
  await first.fill('minimumBidIncrease', 3);
  await first.fill('currencySymbol', '¤');
  await first.click('Duplicate option');
  await first.fill('option-title', 'Copied flame');
  await first.click('Move up');
  assert.equal(await first.evaluate(`document.querySelector('#option-picker').selectedIndex`), 0);
  first.confirm(); await first.click('Remove option');
  await first.click('Add option');
  await first.fill('option-title', 'Azure wings');
  await first.fill('option-description', 'A transparent, portable possibility.');
  await first.click('Move up');
  await first.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Move down').focus()`);
  assert.equal(await first.evaluate('document.activeElement.textContent'), 'Move down');
  await first.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
  await first.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await first.until(`document.querySelector('#option-picker').selectedIndex === 12`);
  const source = await first.evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200; const context = canvas.getContext('2d'); context.fillStyle = '#18594b'; context.fillRect(100, 100, 1000, 900); return canvas.toDataURL('image/png').split(',')[1]; })()`);
  const png = join(output, 'transparent-source.png'); await writeFile(png, Buffer.from(source, 'base64'));
  await first.upload('cover-image', png); await first.upload('option-image', png);
  await first.until(`document.querySelectorAll('.image-tools img').length === 2`);
  await first.evaluate(`document.querySelector('[aria-label="View cover image full size"]').click()`);
  assert.equal(await first.evaluate(`!!document.querySelector('dialog[open]')`), true);
  await first.click('Close image');
  await first.click('Save draft'); await first.saved();
  const [original] = await first.records();
  assert.equal(original.template.title, 'Portable dragons QA');
  assert.equal(original.template.options.length, 13);
  assert.equal(original.template.options[12].title, 'Azure wings');
  assert.equal(original.template.minimumOpeningBid, 2); assert.equal(original.template.minimumBidIncrease, 3);
  assert.equal(original.template.coverImage.mimeType, 'image/png');
  await first.send('Page.reload'); await first.loaded(); await first.saved();
  assert.equal(await first.evaluate(`document.querySelector('#startingCurrency').value`), '49');
  const restored = await first.records(); assert.deepEqual(restored[0].template, original.template);
  await first.fill('option-picker', original.template.options[12].id);
  const pixels = await first.evaluate(`(async () => { const image = document.querySelector('.preview-image img'); await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return { width: canvas.width, height: canvas.height, alpha: ctx.getImageData(0, 0, 1, 1).data[3], filled: ctx.getImageData(200, 200, 1, 1).data[3] }; })()`);
  assert.deepEqual(pixels, { width: 1600, height: 800, alpha: 0, filled: 255 });
  assert.equal(await first.evaluate(`window.injected === undefined && document.querySelector('.theme-preview .preview-description').children.length === 0`), true);
  const imageChecks = await first.evaluate(`(async () => {
    const { processImage } = await import('/src/builder/images.ts');
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 50;
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    const converted = await processImage(jpeg);
    const data = document.querySelector('.image-tools img').src.split(',')[1];
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const hugeSide = bytes.slice(); new DataView(hugeSide.buffer).setUint32(16, 9000);
    const hugePixels = bytes.slice(); const view = new DataView(hugePixels.buffer); view.setUint32(16, 5000); view.setUint32(20, 5000);
    const invalid = [new Blob(['<svg/>'], {type:'image/svg+xml'}), new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], {type:'image/png'}), new Blob([hugeSide], {type:'image/png'}), new Blob([hugePixels], {type:'image/png'}), new Blob([bytes.slice(0, 33)], {type:'image/png'})];
    const outcomes = await Promise.allSettled(invalid.map(file => processImage(file)));
    return { converted: converted.mimeType, outcomes: outcomes.map(result => result.status) };
  })()`);
  assert.equal(imageChecks.converted, 'image/png');
  assert.deepEqual(imageChecks.outcomes, Array(5).fill('rejected'));
  console.log('PASS: editing, keyboard reorder, option operations, real PNG resize/transparency, IndexedDB save and refresh.');
  console.log('PASS: JPEG re-encoding; SVG, file size, pixel/dimension and corrupt-decoder rejection.');

  await first.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await first.click('Export JSON');
  let exported;
  for (let i = 0; i < 100; i++) { exported = (await readdir(output)).find((name) => name.endsWith('.json')); if (exported) break; await delay(75); }
  assert.ok(exported, 'JSON download completed');
  const portable = JSON.parse(await readFile(join(output, exported), 'utf8'));
  assert.deepEqual(portable, original.template);

  await first.click('Save as copy'); await first.saved();
  assert.equal((await first.records()).length, 2);
  await first.fill('saved-drafts', original.id); await first.click('Load draft');
  await first.until(`document.querySelector('#draft-name').value === 'Browser QA original'`);
  await first.send('Page.reload'); await first.loaded(); await first.saved();
  assert.equal(await first.evaluate(`document.querySelector('#draft-name').value`), 'Browser QA original', 'Refresh restores the last loaded draft');
  await first.fill('game-title', 'Edits that must survive a failed save');
  await first.evaluate(`window.originalTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function(stores, mode, ...args) { if (mode === 'readwrite') throw new DOMException('Injected quota exhaustion', 'QuotaExceededError'); return window.originalTransaction.call(this, stores, mode, ...args); };`);
  await first.click('Save draft');
  await first.until(`document.querySelector('[role=alert]')?.textContent.includes('storage is full')`);
  assert.equal(await first.evaluate(`document.querySelector('[data-save-state]').dataset.saveState`), 'unsaved');
  await first.evaluate(`IDBDatabase.prototype.transaction = window.originalTransaction`);
  assert.equal((await first.records()).find((item) => item.id === original.id).template.title, original.template.title);
  await first.evaluate(`document.querySelector('nav a[href="/"]').click()`);
  for (let i = 0; i < 50 && !first.dialogs.some((message) => message.includes('Leave the builder')); i++) await delay(50);
  assert.equal(await first.evaluate('location.pathname'), '/builder');
  assert.ok(first.dialogs.some((message) => message.includes('Leave the builder')));
  await first.click('Save draft'); await first.saved();
  first.confirm(); await first.click('Delete draft');
  assert.equal((await first.records()).length, 1);
  assert.equal(await first.evaluate(`document.querySelector('#game-title').value`), 'Edits that must survive a failed save');
  console.log('PASS: JSON download, duplicate/load/delete drafts, quota failure preserves edits and saved bytes, unsaved navigation protection.');

  const second = await browser();
  assert.equal((await second.records()).length, 0, 'Independent profile has no first-profile drafts');
  // The hidden file input is a genuine native file selection via CDP.
  const document = await second.send('DOM.getDocument');
  const input = await second.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[aria-label="Import template JSON"]' });
  await second.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [join(output, exported)] });
  await second.until(`document.querySelector('#game-title').value === 'Portable dragons QA'`);
  await second.loaded(); await second.click('Save draft'); await second.saved();
  const [imported] = await second.records();
  assert.deepEqual(imported.template, original.template);
  await second.send('Page.reload'); await second.loaded(); await second.saved();
  assert.deepEqual((await second.records())[0].template, original.template);
  const invalid = join(output, 'invalid.json'); await writeFile(invalid, JSON.stringify({ ...portable, options: [portable.options[0], portable.options[0]] }));
  const freshDocument = await second.send('DOM.getDocument');
  const freshInput = await second.send('DOM.querySelector', { nodeId: freshDocument.root.nodeId, selector: 'input[aria-label="Import template JSON"]' });
  await second.send('DOM.setFileInputFiles', { nodeId: freshInput.nodeId, files: [invalid] });
  await second.until(`document.querySelector('[role=alert]')?.textContent.includes('unique')`);
  assert.equal(await second.evaluate(`document.querySelector('#game-title').value`), 'Portable dragons QA');

  // Exercise the repository's real read-modify-write race in native IndexedDB.
  const conflicts = await second.evaluate(`(async () => { const drafts = await import('/src/builder/drafts.ts'); const row = await drafts.loadDraft(); const values = await Promise.allSettled([drafts.saveDraft({ id: row.id, name: 'Concurrent A', template: row.template }, row.revision), drafts.saveDraft({ id: row.id, name: 'Concurrent B', template: row.template }, row.revision)]); return values.map(v => v.status); })()`);
  assert.deepEqual(conflicts.sort(), ['fulfilled', 'rejected']);
  await second.click('Save draft');
  await second.until(`document.querySelector('[role=alert]')?.textContent.includes('another tab')`);
  assert.equal(await second.evaluate(`document.querySelector('[data-save-state]').dataset.saveState`), 'unsaved');
  console.log('PASS: isolated-profile import, exact image-byte round-trip, invalid import preserves editor, concurrent saves reject stale revisions.');

  for (const [width, height] of [[360, 640], [390, 844], [1280, 720], [1440, 900]]) {
    await second.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await second.evaluate('window.scrollTo(0, 0)');
    assert.equal(await second.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `No horizontal overflow at ${width}x${height}`);
    const screenshot = await second.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(output, `builder-${width}x${height}.png`), Buffer.from(screenshot.data, 'base64'));
    const controls = await second.evaluate(`(() => { const controls = [...document.querySelectorAll('.builder button:not(:disabled), .builder input:not([type=file]), .builder select, .builder textarea')]; return controls.filter(el => !el.closest('dialog:not([open]), details:not([open])')).every(el => { el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return r.width > 0 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; }); })()`);
    assert.equal(controls, true, `Controls reachable and touch sized at ${width}x${height}`);
  }
  assert.deepEqual(first.writes, []); assert.deepEqual(second.writes, []);
  assert.deepEqual(first.errors, []); assert.deepEqual(second.errors, []);
  console.log('PASS: four target viewports, reachable controls, no draft/image network writes, no uncaught browser exceptions.');
  console.log(`Screenshots and exported fixture: ${output}`);
} finally {
  for (const browser of browsers) await browser.close();
}
