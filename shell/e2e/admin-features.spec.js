// Covers Admin features that shipped in the India-features wave with
// PHPUnit tests but no Playwright coverage (only manually screenshot at the
// time): the Daily Sales Report, Order History, Excel menu import, and menu
// item images. Kept in its own file/electron instance (rather than tacked
// onto app.spec.js) so it stays fast and independent of the printer-hardware
// tests there.
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// See app.spec.js for why this must be an isolated profile, never the real
// %APPDATA%/dineforge-pos-shell — this suite would delete real restaurant
// data otherwise. A distinct directory from app.spec.js's own isolated
// profile, so both files' electron instances can never collide.
const TEST_USER_DATA_DIR = path.join(require('os').tmpdir(), 'dineforge-e2e-admin-features-profile');
const DB_FILE = path.join(TEST_USER_DATA_DIR, 'data', 'dineforge.sqlite');

function resetDb() {
  for (const suffix of ['', '-shm', '-wal']) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// app.js's boot() renders the POS view (posView.init(), including the "New
// Order" button) *before* it initializes the Admin view and finally calls
// switchView(allowedTabs[0] || 'pos') as its very last line - which for the
// admin role always resolves to 'pos'. Waiting only for "New Order" to
// appear (as app.spec.js does, since it never leaves the POS view) races
// that trailing switchView('pos') call: clicking "Admin" in the gap silently
// gets undone a moment later when boot() finally reaches its own switch.
// #downloadTemplateLink is rendered by adminView.init() (via renderMenu()),
// the step immediately before that trailing switchView() call - and since
// switchView() runs synchronously in the same tick right after
// adminView.init()'s promise resolves, observing this element existing
// means switchView() has already run too. (".tab.active" doesn't work as a
// signal here: index.html hardcodes it on the POS tab by default, so it's
// already "true" before boot() ever runs.)
async function waitForBootComplete(window) {
  await expect(window.locator('#downloadTemplateLink')).toBeAttached();
}

test.describe('DineForge POS admin features', () => {
  /** @type {import('@playwright/test').ElectronApplication} */
  let electronApp;
  /** @type {import('@playwright/test').Page} */
  let window;
  let apiBase;
  let authHeaders;

  test.beforeAll(async () => {
    resetDb();
    electronApp = await _electron.launch({
      args: ['.', `--user-data-dir=${TEST_USER_DATA_DIR}`],
      cwd: path.join(__dirname, '..'),
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Fast wizard walkthrough (already covered in depth by app.spec.js) -
    // just enough to reach a logged-in Admin session.
    await window.locator('#wName').fill('E2E Admin Features Restaurant');
    await window.getByRole('button', { name: 'Next' }).click();
    await window.getByRole('button', { name: 'Next' }).click(); // business details, defaults fine
    await window.getByRole('button', { name: 'Next' }).click(); // tax, defaults fine
    await window.getByRole('button', { name: 'Next' }).click(); // optional, skip
    await window.getByRole('button', { name: 'Start blank' }).click();
    await window.locator('.role-btn[data-role="admin"]').click();
    await window.getByRole('button', { name: 'Sign In' }).click();
    await waitForBootComplete(window);

    apiBase = await window.evaluate(() => window.dineforge.getApiBase());
    const token = await window.evaluate(() => JSON.parse(sessionStorage.getItem('dineforge_session')).token);
    authHeaders = { 'Content-Type': 'application/json', 'X-Session-Token': token };

    // Seed one category/item and a paid order directly through the API -
    // the order-creation UI flow itself is already covered by app.spec.js,
    // this file only needs real data behind it for reports/history to show.
    const category = await (
      await fetch(`${apiBase}/api/menu/categories`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: 'E2E Category' }),
      })
    ).json();
    await fetch(`${apiBase}/api/menu/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ category_id: category.id, name: 'E2E Burger', price_cents: 999 }),
    });
    await fetch(`${apiBase}/api/shifts/open`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ opening_cash_cents: 10000 }),
    });
    const menuItems = await (await fetch(`${apiBase}/api/menu/items`, { headers: authHeaders })).json();
    const burger = menuItems.find((i) => i.name === 'E2E Burger');

    const order = await (
      await fetch(`${apiBase}/api/orders`, { method: 'POST', headers: authHeaders, body: JSON.stringify({}) })
    ).json();
    await fetch(`${apiBase}/api/orders/${order.id}/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ menu_item_id: burger.id, quantity: 1 }),
    });
    await fetch(`${apiBase}/api/orders/${order.id}/payments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ method: 'cash', amount_cents: 999 }),
    });

    // Pick up the seeded data - Admin's Reports/Menu panels only fetch at
    // boot (admin.js's refresh() isn't polled periodically - see app.js's
    // boot(), which deliberately skips refreshing the Admin view).
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await waitForBootComplete(window);
  });

  test.afterAll(async () => {
    await electronApp.close();
    resetDb();
  });

  test('admin reports: daily sales report and order history reflect the seeded paid order', async () => {
    await window.getByRole('button', { name: 'Admin', exact: true }).click();
    await expect(window.locator('#view-admin')).toBeVisible();
    await window.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(window.locator('#admin-reports')).toBeVisible();

    // Card order is fixed in admin.js's renderReports(): Orders, Subtotal,
    // Discounts, Delivery+Packaging, Tax, Total. Default tax rate is 0 and
    // dine-in orders get neither delivery nor packaging fees, so with
    // exactly one $9.99 paid order the whole card row is fully determined.
    const cards = window.locator('#salesReportBox .report-card .report-value');
    await expect(cards.nth(0)).toHaveText('1');
    await expect(cards.nth(1)).toHaveText('$9.99');
    await expect(cards.nth(2)).toHaveText('-$0.00');
    await expect(cards.nth(3)).toHaveText('$0.00');
    await expect(cards.nth(4)).toHaveText('$0.00');
    await expect(cards.nth(5)).toHaveText('$9.99');

    await window.getByRole('button', { name: 'Search', exact: true }).click();
    const historyRows = window.locator('#orderHistoryBox tbody tr');
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows).toContainText('paid');

    await window.locator('#orderHistoryBox a[data-view-order]').click();
    await expect(window.locator('#activeModal')).toContainText('E2E Burger');
    await expect(window.locator('#activeModal')).toContainText('$9.99');
    await window.locator('#orderDetailClose').click();
    await expect(window.locator('#activeModal')).toHaveCount(0);
  });

  test('excel menu import: downloaded template round-trips back through import, then updates in place on re-import', async () => {
    await window.getByRole('button', { name: 'Admin', exact: true }).click();
    await window.getByRole('button', { name: 'Menu', exact: true }).click();

    // Fetch the real .xlsx the backend generates (PhpSpreadsheet writer, one
    // sample row: Burgers / Classic Burger / 9.50) and feed it straight back
    // into the importer - a genuine round trip through the real reader and
    // writer without needing a Node-side xlsx-writing dependency just for
    // this test.
    const templateRes = await fetch(`${apiBase}/api/menu/template`, { headers: authHeaders });
    const templateBuffer = Buffer.from(await templateRes.arrayBuffer());
    const templatePath = path.join(require('os').tmpdir(), 'dineforge-e2e-menu-template.xlsx');
    fs.writeFileSync(templatePath, templateBuffer);

    try {
      await window.locator('#menuImportFile').setInputFiles(templatePath);
      await window.getByRole('button', { name: 'Import' }).click();
      await expect(window.getByText('1 created, 0 updated')).toBeVisible();
      await expect(window.locator('.item-name[value="Classic Burger"]')).toHaveCount(1);

      // Re-importing the identical file must update the existing item in
      // place (case-insensitive category + name match), never duplicate it.
      await window.locator('#menuImportFile').setInputFiles(templatePath);
      await window.getByRole('button', { name: 'Import' }).click();
      await expect(window.getByText('0 created, 1 updated')).toBeVisible();
      await expect(window.locator('.item-name[value="Classic Burger"]')).toHaveCount(1);
    } finally {
      fs.unlinkSync(templatePath);
    }
  });

  test('menu item images: upload shows a thumbnail in Admin and a tile in POS, removing clears both', async () => {
    await window.getByRole('button', { name: 'Admin', exact: true }).click();
    await window.getByRole('button', { name: 'Menu', exact: true }).click();

    // A minimal real 1x1 transparent PNG - the backend only validates the
    // file extension (MenuService::ALLOWED_IMAGE_EXTENSIONS), never decodes
    // the image, so this just needs to be genuine PNG bytes, not anything
    // visually meaningful.
    const pngPath = path.join(require('os').tmpdir(), 'dineforge-e2e-item.png');
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    fs.writeFileSync(pngPath, onePixelPng);

    try {
      const burgerRow = window.locator('tr', { has: window.locator('.item-name[value="E2E Burger"]') });
      await burgerRow.locator('.item-image-upload').click();
      await burgerRow.locator('.item-image-input').setInputFiles(pngPath);
      await expect(window.getByText('Image updated')).toBeVisible();
      await expect(burgerRow.locator('img.item-thumb')).toBeVisible();

      // Reload to pick up the new image_path through the normal POS boot
      // path (pos.js only re-fetches items at init/reload, not on a tab
      // switch - see app.js's boot(), which skips the periodic refresh for
      // whichever view isn't currently active).
      await window.reload();
      await window.waitForLoadState('domcontentloaded');
      await waitForBootComplete(window);
      // pos.js defaults to the alphabetically-first category (MenuService
      // orders by sort_order then name) - the previous test's Excel import
      // created "Burgers", which now sorts ahead of "E2E Category", so it's
      // no longer the one shown by default. Select it explicitly instead of
      // relying on which category happens to be active.
      await window.getByRole('button', { name: 'E2E Category' }).click();
      await expect(window.getByRole('button', { name: 'E2E Burger' }).locator('img.item-card-image')).toBeVisible();

      await window.getByRole('button', { name: 'Admin', exact: true }).click();
      await window.getByRole('button', { name: 'Menu', exact: true }).click();
      const burgerRowAgain = window.locator('tr', { has: window.locator('.item-name[value="E2E Burger"]') });
      await burgerRowAgain.locator('.item-image-remove').click();
      await expect(window.getByText('Image removed')).toBeVisible();
      await expect(burgerRowAgain.locator('img.item-thumb')).toHaveCount(0);
    } finally {
      fs.unlinkSync(pngPath);
    }
  });
});
