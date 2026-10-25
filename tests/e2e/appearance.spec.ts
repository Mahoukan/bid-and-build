import { test, expect, type Page, type Browser, type BrowserContext, type APIRequestContext, type TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { fits } from './board-assertions.js';
import type { GameTemplate } from '../../shared/template.js';
import type { RoomCredentials, RoomSnapshot } from '../../shared/rooms.js';

const origin = 'http://127.0.0.1:3197';
const key = 'bid-build.appearance.v1';
const sizes = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }];
const styles = ['Minimal', 'Glass', 'Neon', 'Paper'];
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Appearance', exact: true });
async function openAppearance(page: Page, game = false) {
  if (game) await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
}
async function closeAppearance(page: Page, game = false) {
  await dialog(page).getByRole('button', { name: 'Close panel' }).click();
  if (game) await page.getByRole('dialog', { name: 'Game menu', exact: true }).getByRole('button', { name: 'Close panel' }).click();
}
async function saveAppearance(page: Page) { await dialog(page).getByRole('button', { name: 'Save appearance', exact: true }).click(); await expect(dialog(page).getByRole('status')).toHaveText('Saved to this browser.'); }
async function background() {
  // Bright striped test fixture stresses the readability overlay; never product art.
  const pixels = Buffer.alloc(480 * 320 * 3);
  for (let y = 0; y < 320; y++) for (let x = 0; x < 480; x++) for (let channel = 0; channel < 3; channel++) pixels[(y * 480 + x) * 3 + channel] = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 255 : 0;
  return { name: 'private-background-test.png', mimeType: 'image/png', buffer: await sharp(pixels, { raw: { width: 480, height: 320, channels: 3 } }).png().toBuffer() };
}
async function setBackground(page: Page) { await dialog(page).getByLabel('Local background image', { exact: true }).setInputFiles(await background()); await expect(dialog(page).getByRole('button', { name: 'Remove background' })).toBeVisible(); }
async function imageCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('bid-build-appearance', 1); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const tx = db.transaction('images', 'readonly'); const count = tx.objectStore('images').count(); tx.oncomplete = () => { db.close(); resolve(count.result); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  }));
}
async function snapshot(request: APIRequestContext, seat: RoomCredentials) { return await (await request.get(`/api/rooms/${seat.code}`, { headers: { Authorization: `Bearer ${seat.token}` } })).json() as RoomSnapshot; }
async function room(browser: Browser, request: APIRequestContext, count: number, optionCount = 2) {
  const template: GameTemplate = { format: 'bid-and-build-template', version: 1, title: 'A remarkably long dragon collection title for responsive appearance verification', description: 'A test-only game with real sockets and authoritative purchases.', coverImage: null, startingCurrency: 1000000, minimumOpeningBid: 1, minimumBidIncrease: 1, currencySymbol: 'Credits:', options: Array.from({ length: optionCount }, (_, index) => ({ id: `appearance-fixture-${index}`, title: `${index + 1} An extraordinarily long option title to keep the complete description available in every theme`.slice(0, 120), description: 'Long descriptions stay reachable through pages. '.repeat(75), image: null })) };
  const contexts: BrowserContext[] = [], pages: Page[] = [], seats: RoomCredentials[] = [];
  for (let i = 0; i < count; i++) {
    const response = await request.post(i ? `/api/rooms/${seats[0]!.code}/join` : '/api/rooms', { headers: { Origin: origin }, data: i ? { name: `Player ${i} with a wonderfully long name` } : { name: 'Hosting player with a very long name', template } });
    expect(response.status()).toBe(201); const seat = await response.json() as RoomCredentials; seats.push(seat);
    const context = await browser.newContext({ baseURL: origin, viewport: sizes[2] }); contexts.push(context); const page = await context.newPage(); pages.push(page);
    await page.goto('/'); await page.evaluate((seat) => localStorage.setItem(`bid-build.seat.${seat.code}`, JSON.stringify(seat)), seat); await page.goto(`/room/${seat.code}`); await expect(page.locator('.game-state')).toHaveText('Lobby');
  }
  return { pages, seats, close: async () => { for (const context of contexts) await context.close(); } };
}
async function hostAction(page: Page, name: string) { await page.getByRole('button', { name: 'Game menu', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click(); }
async function styledViews(page: Page, count: number, phase: string, info: TestInfo) {
  for (const preset of styles) {
    await openAppearance(page, true); await dialog(page).getByRole('button', { name: preset, exact: true }).click();
    await dialog(page).getByLabel('Accent hex').fill('#ffff00'); await dialog(page).getByLabel('Glassy surfaces').check(); await saveAppearance(page); await closeAppearance(page, true);
    for (const size of sizes) {
      await page.setViewportSize(size); await fits(page, count);
      if (phase === 'bidding') {
        await page.getByRole('button', { name: 'Details', exact: true }).click(); await fits(page, count);
        await page.getByRole('button', { name: 'Next text', exact: true }).click(); await expect(page.locator('.game-pager')).toContainText('Text 2 /'); await fits(page, count);
        await page.getByRole('button', { name: 'Close panel', exact: true }).click();
        await page.getByRole('button', { name: 'More bid options' }).click(); await page.getByRole('button', { name: 'Bet All…', exact: true }).click();
        const confirm = page.getByRole('button', { name: /^Confirm Credits:/ }); await expect(confirm).toBeVisible(); await confirm.click({ trial: true }); await page.getByRole('button', { name: 'Close panel', exact: true }).click();
      }
      if ((phase === 'bidding' || phase === 'finished') && count === 5) await page.screenshot({ path: info.outputPath(`${preset}-${phase}-${size.width}.png`) });
    }
  }
}

test('M8 preferences persist locally; cancel/reset preserve drafts and identity; backgrounds never become content uploads', async ({ page, browser }, info) => {
  const writes: string[] = []; page.on('request', (request) => { if (request.method() !== 'GET') writes.push(request.url() + ' ' + (request.postData() ?? '')); });
  await page.goto('/builder'); await page.getByRole('button', { name: 'Use dragon starter' }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved to this browser', { exact: true })).toBeVisible();
  // Sentinel is deliberately not a real room credential; reset must not clear unrelated keys.
  await page.evaluate(() => localStorage.setItem('bid-build.seat.test-retention', 'isolated identity marker'));
  await openAppearance(page); await dialog(page).getByRole('button', { name: 'Neon', exact: true }).click(); await dialog(page).getByLabel('Accent hex').fill('#ffffff'); await setBackground(page); await dialog(page).getByLabel('Glassy surfaces').check();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark'); await saveAppearance(page); await closeAppearance(page);
  expect(writes).toEqual([]); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-preset', 'Neon'); await expect(page.locator('html')).toHaveAttribute('data-background', 'true');
  const stored = await page.evaluate((key) => localStorage.getItem(key)!, key); expect(stored).not.toContain('data:image'); expect(stored).not.toContain('private-background');
  const other = await browser.newContext({ baseURL: origin });
  try { const independent = await other.newPage(); await independent.goto('/'); await expect(independent.locator('html')).toHaveAttribute('data-mode', 'light'); await expect(independent.locator('html')).toHaveAttribute('data-background', 'false'); } finally { await other.close(); }
  await openAppearance(page); await dialog(page).getByRole('button', { name: 'Paper', exact: true }).click(); await closeAppearance(page); await expect(page.locator('html')).toHaveAttribute('data-preset', 'Neon');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON', exact: true }).click(); const exported = await download;
  const stream = await exported.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const content = Buffer.concat(chunks).toString();
  expect(content).not.toContain('backgroundId'); expect(content).not.toContain('glassy'); expect(content).not.toContain(JSON.parse(stored).backgroundId);
  await openAppearance(page); await page.setViewportSize(sizes[0]!); await page.screenshot({ path: info.outputPath('appearance-panel-phone.png') });
  await dialog(page).getByRole('button', { name: 'Reset to Defaults' }).click(); await expect(dialog(page).getByRole('status')).toContainText('Drafts and player identity retained'); await closeAppearance(page);
  await expect(page.locator('html')).toHaveAttribute('data-background', 'false'); await expect(page.locator('html')).toHaveAttribute('data-preset', 'Minimal'); await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('bid-build.seat.test-retention'))).toBe('isolated identity marker');
  await expect(page.getByLabel('Game title', { exact: true })).toHaveValue('Build Your Perfect Dragon'); expect(writes).toEqual([]);
  await openAppearance(page); await dialog(page).getByRole('button', { name: 'Neon', exact: true }).click(); await setBackground(page); await saveAppearance(page); await closeAppearance(page);
  const personalId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).backgroundId as string, key);
  await page.getByRole('button', { name: 'Host game', exact: true }).click(); await page.getByLabel('Your player name', { exact: true }).fill('Appearance test host'); await page.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(page.locator('.game-state')).toHaveText('Lobby');
  const sent = writes.join('\n'); expect(sent).toContain('"template"'); for (const privateField of ['"backgroundId"', '"preset"', '"accent"', '"glass"', personalId]) expect(sent).not.toContain(privateField);
});

test('M8 shared display and recovered seat keep their browser’s appearance; reduced motion, transparency and keyboard space remain usable', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const fixture = await room(browser, request, 2); const host = fixture.pages[0]!;
  const otherContext = await browser.newContext({ baseURL: origin, viewport: sizes[2] });
  const displayContext = await browser.newContext({ baseURL: origin, viewport: sizes[2] });
  try {
    await openAppearance(host, true); await dialog(host).getByRole('button', { name: 'Neon', exact: true }).click(); await setBackground(host); await saveAppearance(host); await closeAppearance(host, true);
    await host.screenshot({ path: info.outputPath('neon-default-landscape.png') });
    await host.getByRole('button', { name: 'Start game', exact: true }).click(); await expect(host.locator('.game-state')).toHaveText('Live auction');
    const access = await (await request.post(`/api/rooms/${fixture.seats[0]!.code}/display`, { headers: { Origin: origin, Authorization: `Bearer ${fixture.seats[0]!.token}` }, data: {} })).json() as { code: string; displayToken: string };
    const display = await displayContext.newPage(); await display.goto(`/display/${access.code}#access=${access.displayToken}`); await expect(display.locator('.game-state')).toHaveText('Live auction');
    await expect(display.locator('html')).toHaveAttribute('data-preset', 'Minimal'); await expect(display.locator('html')).toHaveAttribute('data-background', 'false');
    for (const preset of styles) {
      await openAppearance(display); await dialog(display).getByRole('button', { name: preset, exact: true }).click(); await setBackground(display); await saveAppearance(display); await closeAppearance(display);
      for (const size of sizes) { await display.setViewportSize(size); await fits(display, 2); await expect(display.locator('.primary-actions')).toHaveCount(0); }
    }
    await expect(host.locator('html')).toHaveAttribute('data-preset', 'Neon'); await expect(display.locator('html')).toHaveAttribute('data-preset', 'Paper');
    await display.screenshot({ path: info.outputPath('display-paper-landscape.png') }); await display.reload(); await expect(display.locator('html')).toHaveAttribute('data-preset', 'Paper');
    const before = await snapshot(request, fixture.seats[0]!); await display.close(); expect(await snapshot(request, fixture.seats[0]!)).toEqual(before);
    const next = await otherContext.newPage(); await next.goto('/'); await openAppearance(next); await dialog(next).getByRole('button', { name: 'Glass', exact: true }).click(); await dialog(next).getByLabel('Colour mode').selectOption('dark'); await saveAppearance(next); await closeAppearance(next);
    const outgoing: string[] = []; next.on('websocket', (socket) => socket.on('framesent', ({ payload }) => outgoing.push(payload.toString())));
    await next.goto(`/room/${fixture.seats[0]!.code}`); await next.getByRole('button', { name: 'Recover an existing seat', exact: true }).click(); await next.getByLabel('Private recovery code', { exact: true }).fill(fixture.seats[0]!.recoveryCode!); await next.getByRole('button', { name: 'Recover and take control', exact: true }).click();
    await expect(next.locator('.game-state')).toHaveText('Live auction'); await expect(next.locator('html')).toHaveAttribute('data-preset', 'Glass'); await expect(next.locator('html')).toHaveAttribute('data-mode', 'dark'); await expect(next.locator('html')).toHaveAttribute('data-background', 'false');
    await expect(host.locator('.game-state')).toHaveText('Disconnected'); await expect(host.locator('html')).toHaveAttribute('data-preset', 'Neon');
    const seat = await next.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, fixture.seats[0]!.code);
    expect(seat.playerId).toBe(fixture.seats[0]!.playerId); expect((await snapshot(request, seat)).players).toHaveLength(2);
    await next.getByRole('button', { name: 'Bid Credits:1', exact: true }).click(); await expect(next.locator('.action-summary')).toContainText('You lead');
    for (const privateField of ['"backgroundId"', '"preset"', '"accent"', '"glass"']) expect(outgoing.join('\n')).not.toContain(privateField);
    const cdp = await otherContext.newCDPSession(next);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await next.locator('.game-stage').evaluate((element) => ({ blur: getComputedStyle(element).backdropFilter, animation: getComputedStyle(element).animationName, background: getComputedStyle(element).backgroundColor }))).toMatchObject({ blur: 'none', animation: 'none' });
    expect(await next.locator('.game-stage').evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
    await openAppearance(next, true); await next.setViewportSize({ width: 390, height: 340 });
    await dialog(next).getByLabel('Accent hex').fill('#000000');
    for (const name of ['Save appearance', 'Reset to Defaults', 'Close panel']) { const button = dialog(next).getByRole('button', { name, exact: true }); await button.click({ trial: true }); const box = await button.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(340); }
    await saveAppearance(next); await closeAppearance(next, true);
    await next.setViewportSize(sizes[0]!); await fits(next, 2);
    // Layout space equivalent to 200% desktop zoom; scrolling is intentional
    // at this accessibility size, and controls must remain reachable.
    await next.setViewportSize({ width: 640, height: 360 }); await next.getByRole('button', { name: 'Game menu' }).click(); await next.getByRole('dialog').getByRole('button', { name: 'Close panel' }).click();
    await next.locator('.primary-actions').scrollIntoViewIfNeeded(); await expect(next.locator('.primary-actions')).toBeVisible(); expect(await next.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await next.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
    await next.setViewportSize(sizes[2]!); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); expect(await next.evaluate(() => visualViewport!.scale)).toBe(2); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    const balanceBeforeReset = (await snapshot(request, seat)).players;
    await openAppearance(next, true); await dialog(next).getByRole('button', { name: 'Reset to Defaults' }).click(); await closeAppearance(next, true);
    expect(await next.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!), seat.code)).toEqual(seat); expect((await snapshot(request, seat)).players).toEqual(balanceBeforeReset);
    await next.reload(); await expect(next.locator('.game-state')).toContainText('Paused'); await expect(next.locator('html')).toHaveAttribute('data-preset', 'Minimal'); await hostAction(next, 'Resume game'); await expect(next.locator('.game-state')).toHaveText('Live auction');
  } finally { await otherContext.close(); await displayContext.close(); await fixture.close(); }
});

test('M8 background validation, denied storage, quota errors, stale tabs and missing bytes never report a false save', async ({ page, context }) => {
  await page.goto('/'); await openAppearance(page); await setBackground(page); await saveAppearance(page);
  const original = await page.evaluate((key) => localStorage.getItem(key), key);
  await dialog(page).getByLabel('Local background image', { exact: true }).setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }); await expect(dialog(page).getByRole('alert')).toContainText('PNG or JPEG');
  await dialog(page).getByRole('button', { name: 'Paper', exact: true }).click();
  await setBackground(page);
  await page.evaluate(() => { const original = Storage.prototype.setItem; Object.assign(window, { restoreAppearanceStorage: () => { Storage.prototype.setItem = original; } }); Storage.prototype.setItem = function (key, value) { if (key === 'bid-build.appearance.v1') throw new DOMException('Injected test-only quota', 'QuotaExceededError'); original.call(this, key, value); }; });
  await dialog(page).getByRole('button', { name: 'Save appearance' }).click(); await expect(dialog(page).getByRole('alert')).toContainText('not saved'); expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original); expect(await imageCount(page)).toBe(1);
  await page.evaluate(() => (window as unknown as { restoreAppearanceStorage: () => void }).restoreAppearanceStorage()); await saveAppearance(page);
  const second = await context.newPage(); await second.goto('/'); await openAppearance(second); await dialog(second).getByRole('button', { name: 'Neon', exact: true }).click(); await saveAppearance(second);
  await dialog(page).getByRole('button', { name: 'Save appearance' }).click(); await expect(dialog(page).getByRole('alert')).toContainText('another tab'); await closeAppearance(page); await second.close();
  await openAppearance(page); await dialog(page).getByRole('button', { name: 'Remove background' }).click(); await saveAppearance(page); await closeAppearance(page);
  expect(await imageCount(page)).toBe(0);
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-background', 'false');
  await openAppearance(page);
  // Reject a real IndexedDB transaction commit without touching personal databases.
  await page.evaluate(() => { const transaction = IDBDatabase.prototype.transaction; Object.assign(window, { restoreImageStorage: () => { IDBDatabase.prototype.transaction = transaction; } }); IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) { if (this.name === 'bid-build-appearance' && args[1] === 'readwrite') throw new DOMException('Injected test-only image quota', 'QuotaExceededError'); return transaction.apply(this, args); }; });
  await setBackground(page); await dialog(page).getByRole('button', { name: 'Save appearance' }).click(); await expect(dialog(page).getByRole('alert')).toContainText('not saved');
  await page.evaluate(() => (window as unknown as { restoreImageStorage: () => void }).restoreImageStorage()); await closeAppearance(page); await expect(page.locator('html')).toHaveAttribute('data-background', 'false');
  // A stale pointer from interrupted external storage cleanup can be reset.
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key)!); value.backgroundId = crypto.randomUUID(); localStorage.setItem(key, JSON.stringify(value)); }, key);
  await page.reload(); await openAppearance(page); await expect(dialog(page).getByRole('alert')).toContainText('missing or invalid'); await dialog(page).getByRole('button', { name: 'Reset to Defaults' }).click(); await expect(dialog(page).getByRole('status')).toContainText('Defaults saved');
  await closeAppearance(page); await page.evaluate((key) => localStorage.setItem(key, '{invalid-json'), key); await page.reload(); await openAppearance(page); await expect(dialog(page).getByRole('status')).toContainText('fallback'); await expect(dialog(page).getByRole('alert')).toContainText('could not be read');
  await dialog(page).getByRole('button', { name: 'Reset to Defaults' }).click(); await expect(dialog(page).getByRole('status')).toContainText('Defaults saved');
  await page.evaluate(() => { const original = Storage.prototype.getItem; Object.assign(window, { restoreDeniedStorage: () => { Storage.prototype.getItem = original; } }); Storage.prototype.getItem = function (key) { if (key === 'bid-build.appearance.v1') throw new DOMException('Injected test-only denial', 'SecurityError'); return original.call(this, key); }; });
  await dialog(page).getByRole('button', { name: 'Save appearance' }).click(); await expect(dialog(page).getByRole('alert')).toContainText('Allow site storage'); await page.evaluate(() => (window as unknown as { restoreDeniedStorage: () => void }).restoreDeniedStorage());
});

test('themed collections and history show multiple real purchases at every target size', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const fixture = await room(browser, request, 5, 3); const host = fixture.pages[0]!;
  const readBid = async () => {
    let text = '';
    for (let page = 0; page < 30; page++) { await fits(host, 5); text += await host.getByTestId('text-page').innerText(); const next = host.getByRole('button', { name: 'Next detail', exact: true }); if (!await next.isEnabled()) break; await next.click(); }
    return text;
  };
  try {
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    for (let auction = 0; auction < 2; auction++) {
      await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
      await host.getByRole('button', { name: 'Bid Credits:1', exact: true }).click(); await expect(host.locator('.action-summary')).toContainText('You lead');
      for (const guest of fixture.pages.slice(1)) await guest.getByRole('button', { name: 'Give Up', exact: true }).click();
      await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await hostAction(host, 'Next option');
    }
    await hostAction(host, 'Skip unbid option'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await hostAction(host, 'Next option');
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'finished');
    await openAppearance(host, true); await setBackground(host); await saveAppearance(host); await closeAppearance(host, true);
    for (const preset of styles) {
      await openAppearance(host, true); await dialog(host).getByRole('button', { name: preset, exact: true }).click(); await dialog(host).getByLabel('Accent hex').fill('#ff00ff'); await dialog(host).getByLabel('Glassy surfaces').check(); await saveAppearance(host); await closeAppearance(host, true);
      for (const size of sizes) {
        await host.setViewportSize(size);
        const items = host.locator(`[data-player-id="${fixture.seats[0]!.playerId}"] .collection-item`);
        await expect(items).toHaveCount(2); await expect(items.nth(0)).toContainText('1 An extraordinarily'); await expect(items.nth(1)).toContainText('2 An extraordinarily'); await fits(host, 5);
        await items.nth(1).click(); await expect(host.getByTestId('text-page')).toContainText('2 An extraordinarily'); await fits(host, 5);
        await host.getByRole('button', { name: 'Close panel', exact: true }).click();
        await host.getByRole('button', { name: 'History', exact: true }).click(); expect(await readBid()).toContain('1 An extraordinarily'); await host.getByRole('button', { name: 'Next bid', exact: true }).click();
        expect(await readBid()).toContain('2 An extraordinarily'); await fits(host, 5);
        await host.getByRole('button', { name: 'Close panel', exact: true }).click(); await expect(host.locator('.unclaimed-collection')).toContainText('3 An extraordinarily'); await fits(host, 5);
      }
    }
    expect((await snapshot(request, fixture.seats[0]!)).purchases.map((purchase) => purchase.price)).toEqual([1, 1]);
  } finally { await fixture.close(); }
});

for (const count of [2, 3, 5]) test(`M8 ${count} players: every preset with custom accent, background and glass fits all target views and game phases`, async ({ browser, request }, info) => {
  test.setTimeout(240_000); const fixture = await room(browser, request, count); const host = fixture.pages[0]!;
  try {
    await openAppearance(host, true); await setBackground(host); await saveAppearance(host); await closeAppearance(host, true);
    await styledViews(host, count, 'lobby', info);
    await host.getByRole('button', { name: 'Start game', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
    await styledViews(host, count, 'bidding', info);
    await host.getByRole('button', { name: 'Bid Credits:1', exact: true }).click();
    for (let i = 1; i < count; i++) await fixture.pages[i]!.getByRole('button', { name: 'Give Up', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await styledViews(host, count, 'reveal', info);
    await hostAction(host, 'Next option'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding'); await hostAction(host, 'Pause game');
    for (const preset of styles) {
      await openAppearance(host, true); await dialog(host).getByRole('button', { name: preset, exact: true }).click(); await saveAppearance(host); await closeAppearance(host, true);
      for (const size of sizes) { await host.setViewportSize(size); await fits(host, count); await host.locator('.game-state').click(); await expect(host.getByRole('dialog')).toContainText('explicitly Resume'); await host.getByRole('button', { name: 'Close panel' }).click(); }
    }
    await hostAction(host, 'Resume game'); await hostAction(host, 'Skip unbid option'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await hostAction(host, 'Next option');
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'finished'); await styledViews(host, count, 'finished', info);
    await host.getByRole('button', { name: 'History', exact: true }).click(); await fits(host, count); await host.getByRole('button', { name: 'Close panel', exact: true }).click(); await expect(host.locator('.player-collection .collection-item')).toContainText('extraordinarily');
    expect((await snapshot(request, fixture.seats[0]!)).purchases).toHaveLength(1);
  } finally { await fixture.close(); }
});
