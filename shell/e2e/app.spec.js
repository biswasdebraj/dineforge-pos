// End-to-end smoke test driving the real packaged app (not a browser
// fallback) through Electron's own _electron launcher. Requires no other
// FoodNest POS instance running — the app's single-instance lock (see
// main.js) would otherwise just focus that instance and this test would
// hang waiting for a window that never appears.
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Matches Electron's default userData path (app.getPath('userData')), which
// is based on package.json's "name" field, not electron-builder's
// productName — confirmed by inspecting a real dev run's actual DB location.
const DB_FILE = path.join(process.env.APPDATA, 'foodnest-pos-shell', 'data', 'foodnest.sqlite');

function resetDb() {
  for (const suffix of ['', '-shm', '-wal']) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

test.describe('FoodNest POS smoke test', () => {
  /** @type {import('@playwright/test').ElectronApplication} */
  let electronApp;
  /** @type {import('@playwright/test').Page} */
  let window;

  test.beforeAll(async () => {
    resetDb();
    electronApp = await _electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
    resetDb();
  });

  test('window loads with the correct title', async () => {
    await expect(window).toHaveTitle('FoodNest POS');
  });

  test('full order lifecycle: create, add item, send to kitchen, pay, attempt receipt print', async () => {
    const apiBase = await window.evaluate(() => window.foodnest.getApiBase());

    const category = await (
      await fetch(`${apiBase}/api/menu/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'E2E Category' }),
      })
    ).json();

    await fetch(`${apiBase}/api/menu/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: category.id, name: 'E2E Burger', price_cents: 999 }),
    });

    await fetch(`${apiBase}/api/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_cash_cents: 10000 }),
    });

    // The Order view cached menu/shift state at boot; reload to pick up seed data.
    await window.reload();
    await window.waitForLoadState('domcontentloaded');

    await window.getByRole('button', { name: 'New Order' }).click();
    await expect(window.locator('#orderLabel')).toContainText(/Order #\d{8}-\d{4}/);

    await window.getByRole('button', { name: 'E2E Burger' }).click();
    await expect(window.locator('.cart-totals')).toContainText('$9.99');

    await window.getByRole('button', { name: 'Send to Kitchen' }).click();
    await expect(window.locator('#orderLabel')).toContainText('sent to kitchen');

    await window.getByRole('button', { name: 'Pay', exact: true }).click();
    await window.getByRole('button', { name: 'Confirm Payment' }).click();
    await expect(window.locator('#orderLabel')).toContainText('No order selected');

    // No printer is configured in this test environment. A cash payment
    // fires both an open-cash-drawer and a print-receipt attempt, each
    // failing independently and gracefully (toast) rather than hanging or
    // crashing the app — the printer connect timeout is ~4s.
    await expect(window.getByText(/Printer IP address is not configured/).first()).toBeVisible({ timeout: 8000 });
  });
});
