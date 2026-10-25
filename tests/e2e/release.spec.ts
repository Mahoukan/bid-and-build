import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import dragon from '../../samples/dragon-game.json' with { type: 'json' };
import type { RoomCredentials, RoomSnapshot } from '../../shared/rooms.js';
import { boardSizes, fits } from './board-assertions.js';

async function hostAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Game menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

for (const count of [2, 3, 5]) test(`full sample: ${count} independent browsers import, host, play all twelve options and play again`, async ({ browser, request }, info) => {
  const contexts: BrowserContext[] = []; const pages: Page[] = []; const errors: string[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3197', viewport: index % 2 ? { width: 360, height: 640 } : { width: 1280, height: 720 } }); contexts.push(context);
      const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message)); pages.push(page);
    }
    const host = pages[0]!;
    await host.goto('/builder');
    await host.getByLabel('Import template JSON').setInputFiles(fileURLToPath(new URL('../../samples/dragon-game.json', import.meta.url)));
    await expect(host.getByText('Imported locally. Save to keep it in this browser.')).toBeVisible();
    await host.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(host.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved');
    await host.getByRole('button', { name: 'Host game', exact: true }).click(); await host.getByLabel('Your player name', { exact: true }).fill('Sample host');
    await host.getByRole('button', { name: 'Create room & play', exact: true }).click(); await expect(host.locator('.game-state')).toHaveText('Lobby');
    const code = new URL(host.url()).pathname.split('/').at(-1)!;
    await expect(host.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
    for (let index = 1; index < count; index++) {
      const page = pages[index]!; await page.goto(`/room/${code}`); await page.getByLabel('Your player name', { exact: true }).fill(`Sample player ${index + 1}`);
      await page.getByRole('button', { name: 'Join game', exact: true }).click(); await expect(page.locator('.game-state')).toHaveText('Lobby');
    }
    await expect(host.locator('.player-collection')).toHaveCount(count);
    const seat = await host.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, code);
    const snapshot = async () => {
      const response = await request.get(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${seat.token}` } }); expect(response.ok()).toBe(true); return await response.json() as RoomSnapshot;
    };
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    for (let option = 0; option < dragon.options.length; option++) {
      const winner = option % count;
      for (const page of pages) await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
      const state = await snapshot(); expect(state.current?.option.title).toBe(dragon.options[option]!.title); expect(state.revealedOptions).toHaveLength(option + 1);
      await pages[winner]!.getByRole('button', { name: 'Bid $1', exact: true }).click();
      for (let index = 0; index < count; index++) if (index !== winner) await pages[index]!.getByRole('button', { name: 'Give Up', exact: true }).click();
      for (const page of pages) {
        await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'reveal');
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      await hostAction(host, 'Next option');
    }
    for (const page of pages) await expect(page.locator('.game-board')).toHaveAttribute('data-phase', 'finished');
    const result = await snapshot(); expect(result.completion?.status).toBe('complete'); expect(result.purchases).toHaveLength(12);
    expect(result.purchases.every((purchase) => purchase.price === 1)).toBe(true); expect(result.players.reduce((sum, player) => sum + player.balance, 0)).toBe(count * 20 - 12);
    for (const player of result.players) {
      const total = result.purchases.filter((purchase) => purchase.playerId === player.id).length;
      const build = host.locator(`[data-player-id="${player.id}"]`);
      await expect(build.locator('.collection-totals')).toContainText(`Spent $${total}`);
      await expect(build.locator('.collection-item')).toHaveCount(total);
    }
    for (const size of boardSizes) {
      await host.setViewportSize(size); await fits(host, count);
      // Ordinary 2–3 player sample results should need no collection scrolling.
      if (count <= 3) expect(await host.locator('.comparison-scroll').evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await host.screenshot({ path: info.outputPath(`sample-${count}-player-results-${size.width}.png`) });
    }
    await hostAction(host, 'Play again'); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'lobby');
    const next = await snapshot(); expect(next.runId).not.toBe(result.runId); expect(next.purchases).toHaveLength(0); expect(next.players.every((player) => player.balance === 20)).toBe(true);
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
