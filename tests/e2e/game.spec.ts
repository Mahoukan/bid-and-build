import { test, expect, type Browser, type BrowserContext, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { fits } from './board-assertions.js';
import type { GameTemplate } from '../../shared/template.js';
import type { RoomCredentials, RoomSnapshot } from '../../shared/rooms.js';

const origin = 'http://127.0.0.1:3197';
const sizes = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }];
const names = ['Alexandra the imaginative dragon designer', 'Benjamin with an extraordinarily long hat', 'Cassandra of the friendly mountain valley', 'Dominic the careful collector of treasures', 'Evelyn and the midnight constellation'];
async function fixture(long = false): Promise<GameTemplate> {
  const bytes = await sharp({ create: { width: 700, height: 100, channels: 4, background: { r: 45, g: 112, b: 87, alpha: .7 } } }).png().toBuffer();
  const image = { version: 1 as const, mimeType: 'image/png' as const, data: bytes.toString('base64') };
  return { format: 'bid-and-build-template', version: 1, title: long ? 'A deliberately long title for an extraordinary collection of wonderfully imaginative and completely compatible dragon traits'.slice(0, 120) : 'Playwright test dragons', description: long ? ('Long description with clear line breaks.\n'.repeat(100)).slice(0, 4000) : 'A development test fixture, hosted through the real API.', coverImage: image, startingCurrency: long ? 1_000_000 : 20, currencySymbol: long ? 'Credits:' : '$', minimumOpeningBid: 1, minimumBidIncrease: 1, options: Array.from({ length: 3 }, (_, index) => ({ id: `e2e-option-${index}`, title: long ? `${index + 1} ${'Extraordinarily long dragon option title '.repeat(4)}`.slice(0, 120) : `Dragon trait ${index + 1}`, description: long ? ('Every sentence can be reached.\n'.repeat(140)).slice(0, 3994) + 'FINISH' : `Full public description for trait ${index + 1}.`, image })) };
}
async function createRoom(browser: Browser, request: APIRequestContext, count: number, content?: GameTemplate) {
  content ??= await fixture();
  const contexts: BrowserContext[] = []; const pages: Page[] = []; const seats: RoomCredentials[] = []; const errors: string[] = [];
  for (let index = 0; index < count; index++) {
    const path = index ? `/api/rooms/${seats[0]!.code}/join` : '/api/rooms';
    const response = await request.post(path, { headers: { Origin: origin }, data: index ? { name: names[index]!.slice(0, 40) } : { name: names[0]!.slice(0, 40), template: content } });
    expect(response.status()).toBe(201); const seat = await response.json() as RoomCredentials; seats.push(seat);
    const context = await browser.newContext({ viewport: sizes[2], baseURL: origin }); contexts.push(context);
    const page = await context.newPage(); pages.push(page); page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/'); await page.evaluate((seat) => localStorage.setItem(`bid-build.seat.${seat.code}`, JSON.stringify(seat)), seat); await page.goto(`/room/${seat.code}`);
    await expect(page.locator('.game-state')).toHaveText('Lobby');
  }
  await expect(pages[0]!.locator('.player-collection')).toHaveCount(count);
  return { pages, seats, contexts, errors, content, close: async () => { for (const context of contexts) await context.close(); } };
}
async function state(request: APIRequestContext, seat: RoomCredentials): Promise<RoomSnapshot> {
  const response = await request.get(`/api/rooms/${seat.code}`, { headers: { Authorization: `Bearer ${seat.token}` } }); expect(response.ok()).toBeTruthy(); return await response.json() as RoomSnapshot;
}
async function hostAction(page: Page, name: string) { await page.getByRole('button', { name: 'Game menu', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click(); }
async function viewports(page: Page, count: number, phase: string, info: TestInfo) {
  for (const size of sizes) {
    await page.setViewportSize(size); await fits(page, count);
    await page.screenshot({ path: info.outputPath(`${phase}-${size.width}x${size.height}.png`) });
  }
}

for (const count of [2, 3, 5]) test(`${count} players: fitted lobby, bidding, reveal, results and full public information`, async ({ browser, request }, info) => {
  const room = await createRoom(browser, request, count); const host = room.pages[0]!; const guest = room.pages[1]!;
  try {
    await viewports(host, count, 'lobby', info); await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding'); await viewports(host, count, 'bidding', info);
    await host.getByRole('button', { name: 'More bid options' }).click(); await host.getByLabel('Bid amount', { exact: true }).fill('2'); await host.getByRole('button', { name: 'Confirm bid', exact: true }).click();
    await expect(host.getByRole('button', { name: /^Bid / })).toBeDisabled(); await expect(host.locator('.action-summary')).toContainText('You lead');
    await guest.getByRole('button', { name: 'Bid $3', exact: true }).click(); await expect(host.locator('.action-summary')).toContainText('outbid');
    for (let index = 2; index < count; index++) { await room.pages[index]!.getByRole('button', { name: 'Give Up', exact: true }).click(); await expect(room.pages[index]!.locator('.action-summary')).toContainText('gave up'); }
    await host.getByRole('button', { name: 'Give Up', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await viewports(host, count, 'reveal', info);
    await hostAction(host, 'Next option'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
    await guest.getByRole('button', { name: 'Bid $1', exact: true }).click();
    for (let index = 0; index < count; index++) if (index !== 1) await room.pages[index]!.getByRole('button', { name: 'Give Up', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await hostAction(host, 'Next option');
    await hostAction(host, 'Skip unbid option'); await expect(host.locator('.high-bid')).toContainText('Unclaimed'); await hostAction(host, 'Next option');
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'finished'); await viewports(host, count, 'results', info);
    const result = await state(request, room.seats[0]!); expect(result.completion?.status).toBe('complete'); expect(result.purchases.map((entry) => entry.price)).toEqual([3, 1]);
    for (const size of sizes) {
      await host.setViewportSize(size);
      const build = host.locator(`[data-player-id="${room.seats[1]!.playerId}"]`);
      await expect(build.locator('.collection-totals')).toContainText('2 acquired · Spent $4');
      await expect(build.locator('.collection-item')).toHaveCount(2); await expect(host.locator('.player-collection .collection-empty')).toHaveCount(count - 1); await fits(host, count);
      await build.getByRole('button', { name: 'Dragon trait 2 $1', exact: true }).click(); await expect(host.getByTestId('text-page')).toContainText('Full public description for trait 2'); await fits(host, count);
      await host.getByRole('button', { name: 'Close panel', exact: true }).click();
      await host.getByRole('button', { name: 'History', exact: true }).click(); await expect(host.getByTestId('text-page')).toContainText('bid $2'); await host.getByRole('button', { name: 'Next bid' }).click(); await expect(host.getByTestId('text-page')).toContainText('bid $3'); await fits(host, count);
      await host.getByRole('button', { name: 'Close panel', exact: true }).click();
      await expect(host.locator('.unclaimed-collection')).toContainText('Dragon trait 3'); await fits(host, count);
    }
    await hostAction(host, 'Play again'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'lobby'); expect((await state(request, room.seats[0]!)).players.every((player) => player.balance === 20)).toBeTruthy();
    expect(room.errors).toEqual([]);
  } finally { await room.close(); }
});

test('long content, all balances, text paging, keyboard details and bid confirmations remain usable', async ({ browser, request }, info) => {
  const room = await createRoom(browser, request, 5, await fixture(true)); const host = room.pages[0]!;
  try {
    await host.setViewportSize(sizes[0]!); await fits(host, 5); await host.getByRole('button', { name: 'Start game', exact: true }).click(); await fits(host, 5);
    await host.getByRole('button', { name: 'Details', exact: true }).focus(); await host.keyboard.press('Enter'); await expect(host.getByRole('dialog', { name: 'Option details' })).toBeVisible();
    await expect.poll(() => host.getByRole('button', { name: 'Next text' }).isEnabled()).toBe(true);
    let fullText = ''; let pages = 0;
    do { await fits(host, 5); fullText += await host.getByTestId('text-page').innerText(); pages++; if (!(await host.getByRole('button', { name: 'Next text' }).isEnabled())) break; await host.getByRole('button', { name: 'Next text' }).click(); } while (pages < 150);
    expect(fullText).toContain('FINISH'); expect(fullText.replace(/\s/g, '')).toContain(room.content.options[0]!.description.replace(/\s/g, ''));
    await host.getByRole('button', { name: 'Close panel', exact: true }).click(); await host.getByRole('button', { name: 'More bid options' }).click();
    await host.getByLabel('Bid amount', { exact: true }).fill('1.5'); await expect(host.getByRole('button', { name: 'Confirm bid', exact: true })).toBeDisabled();
    await host.getByLabel('Bid amount', { exact: true }).fill('7');
    // Reduced visual space approximates a keyboard. Real OS keyboards remain a manual check.
    await host.setViewportSize({ width: 390, height: 340 });
    for (const label of ['Confirm bid', 'Cancel']) { const button = host.getByRole('dialog').getByRole('button', { name: label, exact: true }); await button.click({ trial: true }); const box = await button.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(340); }
    await host.getByRole('button', { name: 'Cancel', exact: true }).click(); expect((await state(request, room.seats[0]!)).current?.leader).toBeNull();
    await host.setViewportSize(sizes[0]!); await host.getByRole('button', { name: 'More bid options' }).click(); await host.getByRole('button', { name: 'Bet All…', exact: true }).click();
    await expect(host.getByRole('dialog')).toContainText('Credits:1000000'); await host.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(host.getByRole('button', { name: 'More bid options' })).toBeFocused(); expect((await state(request, room.seats[0]!)).current?.leader).toBeNull();
    await host.screenshot({ path: info.outputPath('long-content-phone.png') });
    await hostAction(host, 'End game…'); await host.getByRole('button', { name: 'Confirm End', exact: true }).click(); await fits(host, 5);
    await expect(host.locator('.unclaimed-collection .collection-item')).toContainText('Unclaimed'); await expect(host.locator('.hidden-options')).toContainText('2 unrevealed unplayed'); await fits(host, 5);
    await host.screenshot({ path: info.outputPath('long-results-phone.png') }); expect(room.errors).toEqual([]);
  } finally { await room.close(); }
});

test('display opens from any player with no seat, secret URL, bid control or disconnect pause', async ({ browser, request }, info) => {
  const room = await createRoom(browser, request, 2); const host = room.pages[0]!; const guest = room.pages[1]!;
  const displayContext = await browser.newContext({ baseURL: origin, viewport: sizes[2] });
  try {
    await guest.getByRole('button', { name: 'Game menu', exact: true }).click(); await guest.getByRole('button', { name: 'Open shared display', exact: true }).click();
    const link = await guest.getByRole('link', { name: 'Launch shared display' }).getAttribute('href'); expect(link).toContain('#access='); for (const seat of room.seats) expect(link).not.toContain(seat.token);
    const display = await displayContext.newPage(); const requests: string[] = []; display.on('request', (req) => requests.push(req.url())); await display.goto(link!);
    await expect(display.locator('.game-state')).toHaveText('Lobby'); expect(new URL(display.url()).hash).toBe('');
    await expect(display.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0); await expect(display.getByRole('button', { name: 'Game menu', exact: true })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Close panel', exact: true }).click(); await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(display.locator('.game-state')).toHaveText('Live auction'); await fits(display, 2); await expect(display.locator('.primary-actions')).toHaveCount(0);
    await expect(display.locator('.room-image')).toBeVisible(); await expect(display.getByText('Dragon trait 2', { exact: true })).toHaveCount(0);
    await display.getByRole('button', { name: 'Fullscreen', exact: true }).click(); await display.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await display.reload(); await expect(display.locator('.game-state')).toHaveText('Live auction');
    await display.screenshot({ path: info.outputPath('shared-display-landscape.png') });
    const before = await state(request, room.seats[0]!); await display.close(); const after = await state(request, room.seats[0]!); expect(after).toEqual(before);
    const again = await displayContext.newPage(); await again.goto(link!); await expect(again.locator('.game-state')).toHaveText('Live auction');
    await guest.close(); await expect(again.locator('.game-state')).toContainText('Paused'); const paused = await state(request, room.seats[0]!); expect(paused.players[1]!.connected).toBe(false); expect(paused.players).toHaveLength(2);
    expect(requests.every((url) => !url.includes('access=') && !url.includes(room.seats[0]!.token) && !url.includes(room.seats[1]!.token))).toBeTruthy();
    const noAccess = await browser.newPage({ baseURL: origin }); await noAccess.goto(`/display/${room.seats[0]!.code}`); await expect(noAccess.getByRole('heading', { name: 'Open a shared display' })).toBeVisible(); await noAccess.close();
  } finally { await displayContext.close(); await room.close(); }
});

test('builder hosting, QR invite, refresh pause, resume, binding End and empty results', async ({ browser, request }, info) => {
  const hostContext = await browser.newContext({ baseURL: origin, viewport: sizes[1] }); const guestContext = await browser.newContext({ baseURL: origin, viewport: sizes[2] });
  try {
    const host = await hostContext.newPage(); await host.goto('/builder'); await host.getByRole('button', { name: 'Use dragon starter', exact: true }).click(); await host.getByRole('button', { name: 'Host game', exact: true }).click();
    await host.getByRole('dialog').getByLabel('Your player name').fill('Host'); await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.locator('.game-state')).toHaveText('Lobby');
    await host.getByRole('button', { name: 'Game menu', exact: true }).click(); await host.getByRole('button', { name: 'Invite friends', exact: true }).click(); await expect(host.getByRole('img', { name: /QR code/ })).toBeVisible();
    const link = await host.getByLabel('Invite link', { exact: true }).inputValue(); await host.getByRole('button', { name: 'Close panel', exact: true }).click();
    const guest = await guestContext.newPage(); await guest.goto(link); await guest.getByLabel('Your player name', { exact: true }).fill('Guest'); await guest.getByRole('button', { name: 'Join game', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled(); await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await guest.getByRole('button', { name: 'Bid $1', exact: true }).click(); await guest.reload(); await expect(guest.locator('.game-state')).toContainText('Paused'); await expect(host.locator('.game-state')).toContainText('Paused');
    await expect(host.getByRole('button', { name: 'Bid $2', exact: true })).toBeDisabled(); await hostAction(host, 'Resume game'); await expect(guest.locator('.game-state')).toHaveText('Live auction');
    await hostAction(host, 'End game…'); await expect(host.getByRole('dialog')).toContainText('binding $1'); await host.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
    await hostAction(host, 'End game…'); await host.getByRole('button', { name: 'Confirm End', exact: true }).click(); await expect(host.locator('.high-bid')).toContainText('Incomplete'); await fits(host, 2);
    await expect(host.locator('.player-collection').filter({ hasText: 'Host' }).locator('.collection-empty')).toContainText('No purchases'); await expect(host.locator('.player-collection').filter({ hasText: 'Guest' }).locator('.collection-totals')).toContainText('Spent $1');
    await expect(host.locator('.hidden-options')).toContainText('11 unrevealed unplayed');
    await host.screenshot({ path: info.outputPath('incomplete-results-phone.png') });
    const code = new URL(host.url()).pathname.split('/').at(-1)!; const seat = await host.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, code); expect((await state(request, seat)).purchases).toHaveLength(1);
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('confirmed Bet All pays the exact balance while other players keep bidding', async ({ browser, request }) => {
  const room = await createRoom(browser, request, 3); const host = room.pages[0]!;
  try {
    await host.setViewportSize(sizes[0]!); await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await host.getByRole('button', { name: 'More bid options' }).click(); await host.getByRole('button', { name: 'Bet All…', exact: true }).click();
    await host.getByRole('button', { name: 'Confirm $20', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal');
    const paid = await state(request, room.seats[0]!); expect(paid.purchases[0]?.price).toBe(20); expect(paid.players[0]?.balance).toBe(0);
    await hostAction(host, 'Next option'); await expect(host.locator('.action-summary')).toContainText('Insufficient funds'); await expect(host.getByRole('button', { name: 'Bid $1', exact: true })).toBeDisabled(); await expect(host.getByRole('button', { name: 'Give Up', exact: true })).toBeDisabled(); await fits(host, 3);
    await room.pages[1]!.getByRole('button', { name: 'Bid $1', exact: true }).click(); await room.pages[2]!.getByRole('button', { name: 'Bid $2', exact: true }).click();
    const live = await state(request, room.seats[0]!); expect(live.phase).toBe('bidding'); expect(live.current?.leader?.amount).toBe(2); expect(live.purchases).toHaveLength(1);
  } finally { await room.close(); }
});

test('original receipts recover without replay and explicit takeover retains the existing host seat', async ({ browser, request }) => {
  const room = await createRoom(browser, request, 2); const host = room.pages[0]!; const guest = room.pages[1]!;
  const duplicateContext = await browser.newContext({ baseURL: origin, viewport: sizes[0] });
  try {
    const cdp = await room.contexts[1]!.newCDPSession(guest); await cdp.send('Network.enable');
    const commands: { type: string; commandId: string; runId: string }[] = []; const queries: { commandId: string }[] = [];
    const record = (frame: string) => {
      try { const [event, body] = JSON.parse(frame.slice(frame.indexOf('['))) as [string, { type: string; commandId: string; runId: string }]; if (event === 'room:command') commands.push(body); if (event === 'room:receipt') queries.push(body); } catch { /* transport heartbeat, not JSON */ }
    };
    cdp.on('Network.webSocketFrameSent', ({ response }) => record(response.payloadData));
    guest.on('request', (request) => { if (request.url().includes('/socket.io/') && request.method() === 'POST') for (const frame of (request.postData() ?? '').split('\x1e')) record(frame); });
    await host.getByRole('button', { name: 'Start game', exact: true }).click(); await guest.getByRole('button', { name: 'Bid $1', exact: true }).click(); await expect(guest.locator('.action-summary')).toContainText('You lead');
    expect(commands).toHaveLength(1); const committed = commands[0]!;
    await hostAction(host, 'End game…'); await host.getByRole('button', { name: 'Confirm End', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'finished'); await hostAction(host, 'Play again');
    await guest.evaluate(({ code, commandId, runId }) => sessionStorage.setItem(`bid-build.pending.${code}`, JSON.stringify({ commandId, runId })), { code: room.seats[1]!.code, commandId: committed.commandId, runId: committed.runId });
    await guest.reload(); await expect(guest.locator('.game-state')).toHaveText('Lobby'); await expect.poll(() => guest.evaluate((code) => sessionStorage.getItem(`bid-build.pending.${code}`), room.seats[1]!.code)).toBeNull();
    expect(commands).toHaveLength(1); expect(queries.some((query) => query.commandId === committed.commandId)).toBeTruthy(); expect((await state(request, room.seats[0]!)).players.map((player) => player.balance)).toEqual([20, 20]);
    const duplicate = await duplicateContext.newPage(); await duplicate.goto('/'); await duplicate.evaluate((seat) => localStorage.setItem(`bid-build.seat.${seat.code}`, JSON.stringify(seat)), room.seats[0]!); await duplicate.goto(`/room/${room.seats[0]!.code}`);
    await expect(duplicate.getByRole('alert')).toContainText('another tab'); await duplicate.getByRole('button', { name: 'Take control here', exact: true }).click(); await duplicate.getByRole('button', { name: 'Confirm takeover', exact: true }).click(); await expect(duplicate.locator('.game-state')).toHaveText('Lobby'); await expect(host.locator('.game-state')).toHaveText('Disconnected');
    const replacement = await duplicate.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, room.seats[0]!.code);
    const restored = await state(request, replacement); expect(restored.hostPlayerId).toBe(room.seats[0]!.playerId); expect(restored.players).toHaveLength(2); expect(replacement.token).not.toBe(room.seats[0]!.token); await fits(duplicate, 2);
  } finally { await duplicateContext.close(); await room.close(); }
});

test('M6 private code replacement and full-room host recovery transfer control without a false pause', async ({ browser, request }, info) => {
  const room = await createRoom(browser, request, 5); const host = room.pages[0]!;
  const replacementContext = await browser.newContext({ baseURL: origin, viewport: sizes[0], permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    await host.setViewportSize(sizes[0]!); await host.getByRole('button', { name: 'Start game', exact: true }).click(); await host.getByRole('button', { name: 'Bid $1', exact: true }).click();
    await hostAction(host, 'Private recovery code'); const original = await host.locator('#saved-private-code').inputValue(); expect(original).toBe(room.seats[0]!.recoveryCode);
    await host.getByRole('button', { name: 'Replace Code', exact: true }).click(); await host.getByRole('button', { name: 'Cancel replacement', exact: true }).click(); expect(await host.locator('#saved-private-code').inputValue()).toBe(original);
    await host.getByRole('button', { name: 'Replace Code', exact: true }).click(); await host.getByRole('button', { name: 'Confirm Replace Code', exact: true }).click();
    await expect(host.getByRole('dialog')).toContainText('New code saved');
    const privateCode = await host.locator('#saved-private-code').inputValue(); expect(privateCode).not.toBe(original);
    await host.getByRole('button', { name: 'Close panel', exact: true }).click();
    const next = await replacementContext.newPage(); const urls: string[] = []; next.on('request', (req) => urls.push(req.url()));
    await next.goto(`/room/${room.seats[0]!.code}`); await next.getByRole('button', { name: 'Recover an existing seat', exact: true }).click();
    await next.getByLabel('Private recovery code', { exact: true }).fill(original); await next.getByRole('button', { name: 'Recover and take control', exact: true }).click(); await expect(next.getByRole('alert')).toContainText('not valid');
    await next.getByLabel('Private recovery code', { exact: true }).fill(privateCode.toLowerCase().replaceAll('-', ' ')); await next.getByRole('button', { name: 'Recover and take control', exact: true }).click();
    await expect(next.locator('.game-state')).toHaveText('Live auction'); await expect(host.locator('.game-state')).toHaveText('Disconnected'); await expect(next.locator('.high-bid')).toContainText('leads $1'); await fits(next, 5);
    const seat = await next.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, room.seats[0]!.code);
    expect(seat.playerId).toBe(room.seats[0]!.playerId); expect(seat.token).not.toBe(room.seats[0]!.token); expect((await state(request, seat)).paused).toBe(false); expect((await state(request, seat)).players).toHaveLength(5);
    expect((await request.get(`/api/rooms/${seat.code}`, { headers: { Authorization: `Bearer ${room.seats[0]!.token}` } })).status()).toBe(401);
    await hostAction(next, 'Private recovery code'); await next.getByRole('button', { name: 'Copy code', exact: true }).click(); expect(await next.evaluate(() => navigator.clipboard.readText())).toBe(privateCode);
    await next.screenshot({ path: info.outputPath('private-code-phone.png') }); await next.getByRole('button', { name: 'Close panel', exact: true }).click();
    for (const url of urls) { expect(url).not.toContain(privateCode); expect(url).not.toContain(seat.token); }
    await next.reload(); await expect(next.locator('.game-state')).toContainText('Paused'); await hostAction(next, 'Resume game'); await expect(next.locator('.game-state')).toHaveText('Live auction');
    expect(await next.evaluate(() => Object.keys(localStorage).filter((key) => /appearance|draft/i.test(key)))).toEqual([]); expect(room.errors).toEqual([]);
  } finally { await replacementContext.close(); await room.close(); }
});

test('M6 network loss, absent Resume, missed-event resync and confirmed Sit Out retain binding money', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const room = await createRoom(browser, request, 3); const [host, guest, third] = room.pages as [Page, Page, Page];
  try {
    await host.setViewportSize(sizes[0]!); await host.getByRole('button', { name: 'Start game', exact: true }).click(); await guest.getByRole('button', { name: 'Bid $1', exact: true }).click();
    await room.contexts[1]!.setOffline(true); await expect(host.locator('.game-state')).toContainText('Paused', { timeout: 50_000 }); await expect(host.getByRole('button', { name: 'Bid $2', exact: true })).toBeDisabled();
    await host.locator('.game-state').click(); await expect(host.getByRole('dialog')).toContainText(names[1]!.slice(0, 40)); await host.getByRole('button', { name: 'Close panel', exact: true }).click();
    await hostAction(host, 'Resume game'); await expect(host.getByRole('dialog')).toContainText('Absence is not Give Up'); await host.getByRole('button', { name: 'Confirm Resume', exact: true }).click(); await host.getByRole('button', { name: 'Bid $2', exact: true }).click();
    await room.contexts[1]!.setOffline(false); await expect(guest.locator('.game-state')).toHaveText('Live auction', { timeout: 15_000 }); await expect(guest.locator('.high-bid')).toContainText('leads $2');
    expect((await state(request, room.seats[0]!)).current?.concededPlayerIds).toEqual([]); expect(await guest.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!).token as string, room.seats[1]!.code)).toBe(room.seats[1]!.token);
    await guest.getByRole('button', { name: 'Bid $3', exact: true }).click();
    await expect(guest.locator('.action-summary')).toContainText('You lead'); await expect(host.locator('.high-bid')).toContainText('leads $3');
    await guest.close(); await expect(host.locator('.game-state')).toContainText('Paused');
    await hostAction(host, `Sit Out ${names[1]!.slice(0, 40)}`); await host.getByRole('button', { name: 'Cancel', exact: true }).click(); expect((await state(request, room.seats[0]!)).players[1]!.sittingOut).toBe(false);
    await hostAction(host, `Sit Out ${names[1]!.slice(0, 40)}`); await host.getByRole('button', { name: 'Confirm Sit Out', exact: true }).click(); await expect(host.locator('.balance-presence').nth(1)).toContainText('Sitting out'); await fits(host, 3);
    expect((await state(request, room.seats[0]!)).purchases).toHaveLength(0); await host.screenshot({ path: info.outputPath('sit-out-paused-phone.png') });
    await hostAction(host, 'Resume game'); await host.getByRole('button', { name: 'Confirm Resume', exact: true }).click(); await host.getByRole('button', { name: 'Give Up', exact: true }).click(); await third.getByRole('button', { name: 'Give Up', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); const result = await state(request, room.seats[0]!); expect(result.purchases).toHaveLength(1); expect(result.purchases[0]!.playerId).toBe(room.seats[1]!.playerId); expect(result.players[1]!.balance).toBe(17);
    await hostAction(host, 'Next option'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding'); expect((await state(request, room.seats[0]!)).paused).toBe(false); expect(room.errors).toEqual([]);
  } finally { await room.close(); }
});

test('M6 lost create and join responses retry the original bootstrap without duplicate seats', async ({ browser, request }) => {
  const hostContext = await browser.newContext({ baseURL: origin }); const guestContext = await browser.newContext({ baseURL: origin });
  try {
    const host = await hostContext.newPage(); const createKeys: string[] = []; let lostCreate: RoomCredentials | null = null;
    await host.route('**/api/rooms', async (route) => {
      const input = route.request().postDataJSON() as { requestKey: string }; createKeys.push(input.requestKey); const response = await route.fetch();
      if (!lostCreate) { lostCreate = await response.json() as RoomCredentials; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await host.goto('/builder'); await host.getByRole('button', { name: 'Use dragon starter', exact: true }).click(); await host.getByRole('button', { name: 'Host game', exact: true }).click(); await host.getByRole('dialog').getByLabel('Your player name').fill('Recovery host');
    await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.getByRole('dialog').getByRole('alert')).toBeVisible(); await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.locator('.game-state')).toHaveText('Lobby'); expect(createKeys).toHaveLength(2); expect(createKeys[0]).toBe(createKeys[1]);
    const code = new URL(host.url()).pathname.split('/').at(-1)!; const seat = await host.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, code); expect(seat).toEqual(lostCreate);
    const guest = await guestContext.newPage(); const joinKeys: string[] = []; let lostJoin: RoomCredentials | null = null;
    await guest.route('**/api/rooms/*/join', async (route) => {
      joinKeys.push((route.request().postDataJSON() as { requestKey: string }).requestKey); const response = await route.fetch();
      if (!lostJoin) { lostJoin = await response.json() as RoomCredentials; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await guest.goto(`/room/${code}`); await guest.getByLabel('Your player name', { exact: true }).fill('Recovery guest'); await guest.getByRole('button', { name: 'Join game', exact: true }).click(); await expect(guest.getByRole('alert')).toBeVisible();
    await guest.reload(); await guest.getByLabel('Your player name', { exact: true }).fill('Recovery guest'); await guest.getByRole('button', { name: 'Join game', exact: true }).click(); await expect(guest.locator('.game-state')).toHaveText('Lobby');
    expect(joinKeys).toHaveLength(2); expect(joinKeys[0]).toBe(joinKeys[1]); expect((await state(request, seat)).players).toHaveLength(2); expect(await guest.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, code)).toEqual(lostJoin);
  } finally { await hostContext.close(); await guestContext.close(); }
});
