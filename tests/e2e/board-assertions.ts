import { expect, type Page } from '@playwright/test';

export const boardSizes = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }];

export async function fits(page: Page, count: number) {
  const board = page.locator('.game-board');
  const finished = await board.getAttribute('data-phase') === 'finished';
  const viewport = page.viewportSize()!;
  const portrait = viewport.width <= 700 && viewport.height >= viewport.width;
  await expect(board).toHaveAttribute('data-layout', portrait ? 'portrait' : 'landscape');
  await expect(page.locator(portrait && !finished ? '.balance-card' : '.collections-area .player-collection')).toHaveCount(count);
  await expect.poll(() => page.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth + 1, y: document.documentElement.scrollHeight <= innerHeight + 1 }))).toEqual({ x: true, y: true });
  for (const locator of [page.locator('.high-bid'), page.locator('.game-actions'), ...await page.locator('.game-panel, .balance-card, .primary-actions button, .own-collection').all()]) {
    await expect(locator).toBeVisible(); const box = await locator.boundingBox(); const viewport = page.viewportSize()!;
    expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(-1); expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  // Collections may scroll vertically; neither the main shell nor a collection
  // may overflow horizontally. Acquired names must wrap, never clamp or clip.
  for (const surface of await page.locator('.comparison-scroll, .collection-scroll, .game-panel').all()) {
    expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  for (const name of await page.locator('.collection-label strong').all()) {
    expect(await name.evaluate((element) => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1 && getComputedStyle(element).webkitLineClamp === 'none')).toBe(true);
  }
  if (!await page.locator('dialog[open]').count()) {
    for (const button of await page.locator('.primary-actions button:enabled, .board-tools button').all()) await button.click({ trial: true });
  }
  for (const panel of await page.locator('.game-panel').all()) expect(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
}
