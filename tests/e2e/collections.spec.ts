import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import dragon from '../../samples/dragon-game.json' with { type: 'json' };
import type { GameTemplate } from '../../shared/template.js';
import type { GameCommand } from '../../shared/game.js';
import type { RoomCredentials, RoomSnapshot, RoomClientEvents, RoomServerEvents } from '../../shared/rooms.js';
import { boardSizes, fits } from './board-assertions.js';

const origin = 'http://127.0.0.1:3197';
type Client = Socket<RoomServerEvents, RoomClientEvents>;
async function hostAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

for (const count of [2, 3, 5]) test(`M10 ${count} players: uneven collections, keyboard details and bounded overflow stay usable`, async ({ page, browser, request }, info) => {
  const long = count === 5;
  const template = (long ? {
    ...dragon, title: 'Long collection — test fixture', startingCurrency: 100,
    options: Array.from({ length: 32 }, (_, index) => ({ id: `collection-${index}`, title: `${index + 1} ${'An extraordinarily long acquired option name '.repeat(3)}`.slice(0, 120), description: `Complete description for collection item ${index + 1}.`, image: null })),
  } : dragon) as GameTemplate;
  const clients: Client[] = []; const seats: RoomCredentials[] = []; const errors: string[] = [];
  const displayContext = await browser.newContext({ baseURL: origin, viewport: boardSizes[2] });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (let index = 0; index < count; index++) {
      const response = await request.post(index ? `/api/rooms/${seats[0]!.code}/join` : '/api/rooms', { headers: { Origin: origin }, data: index ? { name: long ? `Player ${index} with a wonderfully long name` : `Player ${index + 1}` } : { name: long ? 'Host with a long collection and name' : 'Host', template } });
      expect(response.status(), response.ok() ? '' : await response.text()).toBe(201); const seat = await response.json() as RoomCredentials; seats.push(seat);
      if (index) {
        const client: Client = io(origin, { auth: { code: seat.code, token: seat.token }, transports: ['websocket'], extraHeaders: { Origin: origin }, autoConnect: false, reconnection: false }); clients.push(client);
        await new Promise<void>((resolve, reject) => { client.once('room:snapshot', () => resolve()); client.once('connect_error', reject); client.connect(); });
      }
    }
    const seat = seats[0]!;
    const snapshot = async () => await (await request.get(`/api/rooms/${seat.code}`, { headers: { Authorization: `Bearer ${seat.token}` } })).json() as RoomSnapshot;
    await page.goto('/'); await page.evaluate((seat) => localStorage.setItem(`bid-build.seat.${seat.code}`, JSON.stringify(seat)), seat); await page.goto(`/room/${seat.code}`);
    await page.setViewportSize(boardSizes[0]!); await page.getByRole('button', { name: 'Start game', exact: true }).click();
    const displayAccess = await (await request.post(`/api/rooms/${seat.code}/display`, { headers: { Origin: origin, Authorization: `Bearer ${seat.token}` }, data: {} })).json() as { displayToken: string };
    const display = await displayContext.newPage(); await display.goto(`/display/${seat.code}#access=${displayAccess.displayToken}`);
    if (long) {
      for (const size of [boardSizes[0]!, boardSizes[2]!]) {
        await page.setViewportSize(size);
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        expect(await page.locator('.primary-actions button').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(28);
        await page.locator('.primary-actions').scrollIntoViewIfNeeded();
        for (const button of await page.locator('.primary-actions button').all()) await button.click({ trial: true });
        if (size.width < 700) {
          const own = await page.locator('.own-collection').boundingBox(); const actions = await page.locator('.action-summary').boundingBox();
          expect(actions!.y, 'enlarged actions must not overlap the collection').toBeGreaterThanOrEqual(own!.y + own!.height);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`enlarged-text-${size.width}.png`) });
        await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); window.scrollTo(0, 0); });
      }
      await page.setViewportSize(boardSizes[0]!);
    }
    // Real browser host bids, real independent Socket.IO opponents concede.
    // Never inject snapshots, ledger rows or component props to fabricate ownership.
    for (let index = 0; index < template.options.length; index++) {
      await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
      await page.getByRole('button', { name: 'Bid $1', exact: true }).click(); let state = await snapshot();
      if (index === 0) await page.getByRole('button', { name: 'Compare builds', exact: true }).click();
      for (const client of clients) {
        const command: GameCommand = { commandId: randomUUID(), gameId: state.gameId, runId: state.runId, auctionId: state.current!.auctionId, phase: state.phase, type: 'giveUp' };
        const reply = await client.timeout(3000).emitWithAck('room:command', command);
        if (!reply.ok) throw new Error(reply.error.message); expect(reply.receipt?.ok).toBe(true); state = reply.snapshot;
      }
      await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'reveal');
      if (index === 0) {
        const comparison = page.getByRole('dialog', { name: 'Compare builds', exact: true });
        await expect(comparison.locator('.comparison-current')).toContainText('Revealing');
        await expect(comparison.locator('.collection-item')).toHaveCount(1);
        await comparison.getByRole('button', { name: 'Back to bidding' }).click();
      }
      await expect(page.locator('.own-collection .collection-item')).toHaveCount(index + 1);
      await expect(display.locator('.player-collection .collection-item')).toHaveCount(index + 1);
      // Inspect the complete collection before advancement, without item paging.
      if (index === template.options.length - 2) {
        for (const size of boardSizes) {
          await page.setViewportSize(size); await fits(page, count);
          const collection = page.locator(size.width < 700 ? '.collection-scroll' : '.collections-area .comparison-scroll');
          await collection.locator('.collection-item').last().scrollIntoViewIfNeeded();
          await fits(page, count);
          if (size.width >= 700) for (const heading of await page.locator('.player-collection .collection-heading').all()) await expect(heading).toBeInViewport({ ratio: 1 });
          if (long) expect(await collection.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
          await page.screenshot({ path: info.outputPath(`uneven-live-${size.width}.png`) });
        }
        await page.setViewportSize(boardSizes[0]!); await page.getByRole('button', { name: 'Compare builds', exact: true }).click();
        const comparison = page.getByRole('dialog', { name: 'Compare builds', exact: true });
        await expect(comparison.locator('.player-collection')).toHaveCount(count);
        expect(await comparison.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
        expect(await comparison.locator('.player-collection').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-player-id')))).toEqual(seats.map((entry) => entry.playerId));
        const last = comparison.locator('.collection-item').last(); await last.focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Option details' })).toBeVisible(); await expect(page.getByTestId('text-page')).toContainText(template.options[index]!.description);
        await page.keyboard.press('Escape'); await expect(last).toBeFocused();
        await comparison.getByRole('button', { name: 'Back to bidding' }).click(); await expect(page.getByRole('button', { name: 'Compare builds', exact: true })).toBeFocused();
      }
      await hostAction(page, 'Next option');
    }
    await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'finished');
    const result = await snapshot(); expect(result.purchases).toHaveLength(template.options.length); expect(result.players[0]!.balance).toBe(template.startingCurrency - template.options.length);
    for (const size of boardSizes) {
      await page.setViewportSize(size); await fits(page, count);
      await expect(page.locator('.player-collection')).toHaveCount(count);
      await expect(page.locator('.player-collection .collection-item')).toHaveCount(template.options.length);
      await expect(page.locator('.collection-empty')).toHaveCount(count - 1);
      await expect(page.locator('.collection-thumbnail .image-placeholder')).toHaveCount(template.options.length);
      const scroll = page.locator('.comparison-scroll');
      if (!long) expect(await scroll.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await scroll.locator('.collection-item').last().click(); await expect(page.getByTestId('text-page')).toContainText(template.options.at(-1)!.description); await page.keyboard.press('Escape');
      await scroll.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`uneven-results-${size.width}.png`) });
    }
    await expect(display.locator('.game-board')).toHaveAttribute('data-phase', 'finished'); await fits(display, count);
    await expect(display.locator('.player-collection .collection-item')).toHaveCount(template.options.length);
    await expect(display.getByRole('button', { name: /^(Bid |Give Up|Game menu|Play again)/ })).toHaveCount(0);
    await display.locator('.collection-item').last().click(); await expect(display.getByRole('dialog', { name: 'Option details' })).toBeVisible();
    const beforeClose = await snapshot(); await display.close(); expect(await snapshot()).toEqual(beforeClose); expect(errors).toEqual([]);
  } finally { clients.forEach((client) => client.disconnect()); await displayContext.close(); }
});
