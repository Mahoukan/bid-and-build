import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createRuntime } from '../../server/app.js';
import { parseConfig } from '../../server/config.js';
import type { RoomCredentials, RoomSnapshot } from '../../shared/rooms.js';
import dragon from '../../samples/dragon-game.json' with { type: 'json' };

// A non-localhost HTTP hostname gives real browser insecure-context behaviour.
// Only Chromium DNS is mapped; Origin validation and crypto APIs are untouched.
const origin = 'http://bid-build-lan.test:3198';
const direct = 'http://127.0.0.1:3198';
test.use({ launchOptions: { ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--host-resolver-rules=MAP bid-build-lan.test 127.0.0.1', '--no-proxy-server'] } });
let runtime: ReturnType<typeof createRuntime>;
let config: ReturnType<typeof parseConfig>;
let directory: string;
async function start() { runtime = createRuntime(config, { revealMs: 60_000 }); runtime.httpServer.listen(3198, '127.0.0.1'); await once(runtime.httpServer, 'listening'); }
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bid-build-lan-test-'));
  config = parseConfig({ NODE_ENV: 'production', APP_ORIGIN: origin, DATA_DIR: directory, SESSION_SECRET: randomBytes(48).toString('hex') });
  await start();
});
test.afterAll(async () => {
  await runtime?.close();
  if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('bid-build-lan-test-')) await rm(directory, { recursive: true, force: true });
});
async function insecure(page: Page) {
  expect(await page.evaluate(() => ({ secure: isSecureContext, subtle: typeof crypto.subtle, random: typeof crypto.getRandomValues }))).toEqual({ secure: false, subtle: 'undefined', random: 'function' });
}
async function hostAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

test('LAN HTTP: phone joins, bids, refreshes, survives server restart and recovers its seat', async ({ browser, request }) => {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const recoveryContext = await browser.newContext();
  try {
    const created = await request.post(`${direct}/api/rooms`, { headers: { Origin: origin }, data: { name: 'LAN host', template: dragon } }); expect(created.status()).toBe(201);
    const hostSeat = await created.json() as RoomCredentials;
    const host = await hostContext.newPage(); await host.goto(origin); await insecure(host);
    await host.evaluate((seat) => localStorage.setItem(`bid-build.seat.${seat.code}`, JSON.stringify(seat)), hostSeat); await host.goto(`${origin}/room/${hostSeat.code}`);
    const guest = await guestContext.newPage(); await guest.goto(`${origin}/room/${hostSeat.code}`); await insecure(guest);
    await guest.getByLabel('Your player name', { exact: true }).fill('Phone player'); await guest.getByRole('button', { name: 'Join game', exact: true }).click();
    await expect(guest.locator('.game-state')).toHaveText('Lobby');
    const guestSeat = await guest.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, hostSeat.code);
    const state = async () => await (await request.get(`${direct}/api/rooms/${hostSeat.code}`, { headers: { Authorization: `Bearer ${hostSeat.token}` } })).json() as RoomSnapshot;
    await host.getByRole('button', { name: 'Start game', exact: true }).click(); await guest.getByRole('button', { name: 'Bid $1', exact: true }).click();
    await guest.reload(); await expect(host.locator('.game-state')).toContainText('Paused'); await expect(guest.locator('.game-state')).toContainText('Paused');
    expect((await state()).players.map((player) => player.id)).toEqual([hostSeat.playerId, guestSeat.playerId]);
    await hostAction(host, 'Resume game'); await host.getByRole('button', { name: 'Give Up', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal'); await hostAction(host, 'Next option');
    await guest.getByRole('button', { name: 'Bid $1', exact: true }).click(); await expect(guest.locator('.action-summary')).toContainText('You lead');
    await runtime.close(); await expect(host.locator('.game-state')).toHaveText('Disconnected'); await expect(host.getByRole('button', { name: 'Bid $2', exact: true })).toBeDisabled();
    await start(); await expect(host.locator('.game-state')).toContainText('Paused'); await expect(guest.locator('.game-state')).toContainText('Paused');
    await expect.poll(async () => (await state()).players.every((player) => player.connected)).toBe(true);
    expect((await state()).purchases).toHaveLength(1); expect((await state()).current?.leader?.amount).toBe(1);
    await hostAction(host, 'Resume game'); await host.getByRole('button', { name: 'Give Up', exact: true }).click();
    await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal');
    const recovered = await recoveryContext.newPage(); await recovered.goto(`${origin}/room/${hostSeat.code}`); await insecure(recovered);
    await recovered.getByRole('button', { name: 'Recover an existing seat', exact: true }).click(); await recovered.getByLabel('Private recovery code', { exact: true }).fill(guestSeat.recoveryCode!);
    await recovered.getByRole('button', { name: 'Recover and take control', exact: true }).click(); await expect(recovered.locator('.game-state')).toHaveText('Revealing'); await expect(guest.locator('.game-state')).toHaveText('Disconnected');
    const final = await state(); expect(final.hostPlayerId).toBe(hostSeat.playerId); expect(final.players).toHaveLength(2); expect(final.players[1]!.id).toBe(guestSeat.playerId); expect(final.players[1]!.balance).toBe(18); expect(final.purchases).toHaveLength(2); expect(final.paused).toBe(false);
    await recovered.getByRole('button', { name: 'Game menu', exact: true }).click(); await expect(recovered.getByRole('button', { name: 'Pause game', exact: true })).toHaveCount(0);
  } finally { await hostContext.close(); await guestContext.close(); await recoveryContext.close(); }
});

test('LAN HTTP: lost host and join responses retain SHA-256 retry metadata through refresh', async ({ browser, request }) => {
  const hostContext = await browser.newContext(); const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage(); const hostKeys: string[] = []; let hostSeat: RoomCredentials | undefined; let fingerprint = '';
    await host.route('**/api/rooms', async (route) => {
      const { requestKey, ...body } = route.request().postDataJSON() as { requestKey: string; [key: string]: unknown }; hostKeys.push(requestKey);
      fingerprint = createHash('sha256').update(JSON.stringify({ body })).digest('hex');
      // route.fetch runs in Node, outside Chromium's test-only DNS mapping.
      // Keep the browser's original Origin header and body intact.
      const response = await route.fetch({ url: route.request().url().replace(origin, direct) });
      if (!hostSeat) { hostSeat = await response.json() as RoomCredentials; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await host.goto(`${origin}/builder`); await insecure(host); await host.getByRole('button', { name: 'Use dragon starter', exact: true }).click(); await host.getByRole('button', { name: 'Host game', exact: true }).click();
    await host.getByLabel('Your player name', { exact: true }).fill('LAN host Δ🐲'); await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.getByRole('dialog').getByRole('alert')).toBeVisible();
    expect(await host.evaluate(() => JSON.parse(localStorage.getItem('bid-build.request./api/rooms')!))).toEqual({ fingerprint, requestKey: hostKeys[0] });
    await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.locator('.game-state')).toHaveText('Lobby'); expect(hostKeys).toHaveLength(2); expect(hostKeys[0]).toBe(hostKeys[1]);
    const guest = await guestContext.newPage(); const guestKeys: string[] = []; let guestSeat: RoomCredentials | undefined;
    await guest.route('**/api/rooms/*/join', async (route) => {
      guestKeys.push((route.request().postDataJSON() as { requestKey: string }).requestKey); const response = await route.fetch({ url: route.request().url().replace(origin, direct) });
      if (!guestSeat) { guestSeat = await response.json() as RoomCredentials; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await guest.goto(`${origin}/room/${hostSeat!.code}`); await guest.getByLabel('Your player name', { exact: true }).fill('Phone Δ🐲'); await guest.getByRole('button', { name: 'Join game', exact: true }).click(); await expect(guest.getByRole('alert')).toBeVisible();
    const pending = await guest.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.request./api/rooms/${code}/join`)!), hostSeat!.code);
    expect(pending).toEqual({ fingerprint: createHash('sha256').update(JSON.stringify({ body: { name: 'Phone Δ🐲' } })).digest('hex'), requestKey: guestKeys[0] });
    await guest.reload(); await guest.getByLabel('Your player name', { exact: true }).fill('Phone Δ🐲'); await guest.getByRole('button', { name: 'Join game', exact: true }).click(); await expect(guest.locator('.game-state')).toHaveText('Lobby');
    expect(guestKeys).toHaveLength(2); expect(guestKeys[0]).toBe(guestKeys[1]);
    expect(await guest.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!), hostSeat!.code)).toEqual(guestSeat);
    const snapshot = await (await request.get(`${direct}/api/rooms/${hostSeat!.code}`, { headers: { Authorization: `Bearer ${hostSeat!.token}` } })).json() as RoomSnapshot; expect(snapshot.players).toHaveLength(2);
  } finally { await hostContext.close(); await guestContext.close(); }
});
