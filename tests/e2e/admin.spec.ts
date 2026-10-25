import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { AdminSession, AdminTemplate } from '../../shared/admin.js';
import type { RoomCredentials, RoomSnapshot } from '../../shared/rooms.js';

const origin = 'http://127.0.0.1:3197';
async function signIn(page: Page) {
  await page.getByLabel('Admin username').fill('browser-test-admin');
  await page.getByLabel('Password', { exact: true }).fill('Isolated-browser-test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New template', exact: true })).toBeVisible();
}
async function save(page: Page) { await page.getByRole('button', { name: 'Save template', exact: true }).first().click(); await expect(page.getByRole('status').filter({ hasText: 'Template saved.' })).toBeVisible(); }

test('admin editor: durable sign-in, shared option/image controls, stale writes, logout and retained unsaved edits', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin'); await signIn(page);
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  await page.getByLabel('Game title', { exact: true }).fill('Browser collection fixture');
  await page.getByLabel('Option title', { exact: true }).fill('First browser option');
  await page.getByLabel('Starting currency').fill('30'); await page.getByLabel('Opening price').fill('2'); await page.getByLabel('Minimum bid increase').fill('3');
  const png = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#f3a13c' } }).png().toBuffer();
  await page.getByLabel('Cover image', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Cover image preview')).toBeVisible();
  await page.getByLabel('Option image', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Option image preview')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate option', exact: true }).click();
  await page.getByLabel('Option title', { exact: true }).fill('Second browser option');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await save(page); await page.reload(); await expect(page.getByRole('button', { name: 'New template' })).toBeVisible();
  await page.locator('.admin-template-list button').filter({ hasText: 'Browser collection fixture' }).click();
  await expect(page.getByLabel('Option title', { exact: true })).toHaveValue('Second browser option');
  await expect(page.getByLabel('Opening price')).toHaveValue('2'); await expect(page.getByLabel('Minimum bid increase')).toHaveValue('3');
  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('admin-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: info.outputPath('admin-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Publish', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate template', exact: true }).click();
  await expect(page.getByLabel('Game title', { exact: true })).toHaveValue('Browser collection fixture (copy)');
  // Force a real competing saved revision through the same protected API.
  const session = await (await page.request.get('/api/admin/session')).json() as Extract<AdminSession, { authenticated: true }>;
  const list = await (await page.request.get('/api/admin/templates')).json() as { templates: { id: string; title: string }[] };
  const id = list.templates.find((item) => item.title.endsWith('(copy)'))!.id;
  const item = await (await page.request.get(`/api/admin/templates/${id}`)).json() as AdminTemplate;
  expect((await page.request.put(`/api/admin/templates/${id}`, { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: { revision: item.revision, template: { ...item.template, description: 'Competing edit' } } })).status()).toBe(200);
  await page.getByLabel('Game title', { exact: true }).fill('Unsaved local admin edit');
  await page.getByRole('button', { name: 'Save template', exact: true }).first().click(); await expect(page.getByRole('alert')).toContainText('another session');
  await expect(page.getByLabel('Game title', { exact: true })).toHaveValue('Unsaved local admin edit');
  await page.getByRole('link', { name: 'Templates', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved template' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Game title', { exact: true })).toHaveValue('Unsaved local admin edit');
  // Revoke the cookie server-side while this tab still has an open editor.
  expect((await page.request.post('/api/admin/logout', { headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken }, data: {} })).status()).toBe(200);
  await page.getByRole('button', { name: 'Save template', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  await expect(page.getByText('Unsaved editor contents are still in this tab.')).toBeVisible();
  await signIn(page); await expect(page.getByLabel('Game title', { exact: true })).toHaveValue('Unsaved local admin edit');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Reload saved template' }).click();
  await expect(page.getByLabel('Game description (optional)')).toHaveValue('Competing edit');
  page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: 'Delete template', exact: true }).click(); await expect(page.getByLabel('Game title', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Delete template', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Template deleted.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
  expect((await page.request.get('/api/admin/templates')).status()).toBe(401); expect(errors).toEqual([]);
});

test('published catalogue: guests host without future content; deleting the source preserves active room images', async ({ page: admin, browser }, info) => {
  await admin.goto('/admin'); await signIn(admin); await admin.getByRole('button', { name: 'New template', exact: true }).click();
  await admin.getByLabel('Game title', { exact: true }).fill('Guest catalogue fixture');
  await admin.getByLabel('Option title', { exact: true }).fill('Visible first option');
  const png = await sharp({ create: { width: 160, height: 100, channels: 4, background: '#559a89' } }).png().toBuffer();
  await admin.getByLabel('Cover image', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png }); await expect(admin.getByAltText('Cover image preview')).toBeVisible();
  await admin.getByLabel('Option image', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png }); await expect(admin.getByAltText('Option image preview')).toBeVisible();
  await admin.getByRole('button', { name: 'Duplicate option', exact: true }).click(); await admin.getByLabel('Option title', { exact: true }).fill('Never disclose this future option');
  await save(admin); await admin.getByRole('button', { name: 'Publish', exact: true }).click(); await expect(admin.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
  const guestContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const host = await guestContext.newPage();
  try {
    const preview = await (await host.request.get('/api/templates')).json(); expect(JSON.stringify(preview)).not.toContain('Never disclose'); expect(JSON.stringify(preview)).not.toContain('Visible first');
    await host.goto('/templates'); await expect(host.getByRole('heading', { name: 'Guest catalogue fixture', exact: true })).toBeVisible();
    await host.screenshot({ path: info.outputPath('catalogue-phone.png'), fullPage: true });
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await host.getByRole('button', { name: 'Host Guest catalogue fixture', exact: true }).click(); await host.getByLabel('Your player name').fill('Guest host'); await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(host.locator('.game-state')).toHaveText('Lobby'); const code = host.url().split('/').at(-1)!;
    const seat = await host.evaluate((code) => JSON.parse(localStorage.getItem(`bid-build.seat.${code}`)!) as RoomCredentials, code);
    const second = await browser.newContext({ baseURL: origin });
    try {
      const guest = await second.newPage(); await guest.goto(`/room/${code}`); await guest.getByLabel('Your player name').fill('Second guest'); await guest.getByRole('button', { name: 'Join game', exact: true }).click();
      await expect(host.locator('.balance-card')).toHaveCount(2); await host.getByRole('button', { name: 'Start game', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding');
      const before = await (await host.request.get(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${seat.token}` } })).json() as RoomSnapshot;
      expect(JSON.stringify(before)).not.toContain('Never disclose'); const media = `/api/rooms/${code}/media/${before.current!.option.imageAssetId}`;
      const bytes = await (await host.request.get(media, { headers: { Authorization: `Bearer ${seat.token}` } })).body();
      await admin.getByLabel('Game title', { exact: true }).fill('Source changed during game'); await save(admin);
      pageConfirm(admin); await admin.getByRole('button', { name: 'Delete template', exact: true }).click(); await expect(admin.getByRole('status').filter({ hasText: 'Template deleted.' })).toBeVisible();
      const after = await (await host.request.get(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${seat.token}` } })).json(); expect(after).toEqual(before);
      expect(await (await host.request.get(media, { headers: { Authorization: `Bearer ${seat.token}` } })).body()).toEqual(bytes);
      await guest.getByRole('button', { name: 'Give Up', exact: true }).click(); await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'reveal');
      await host.getByRole('button', { name: 'Game menu', exact: true }).click(); await host.getByRole('dialog').getByRole('button', { name: 'Next option', exact: true }).click();
      await expect(host.locator('.game-board')).toHaveAttribute('data-phase', 'bidding'); await expect(host.locator('.option-title')).toContainText('Never disclose');
      expect((await host.request.get('/api/admin/templates')).status()).toBe(401);
    } finally { await second.close(); }
  } finally { await guestContext.close(); }
});
function pageConfirm(page: Page) { page.once('dialog', (dialog) => dialog.accept()); }
