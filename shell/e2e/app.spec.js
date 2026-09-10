// End-to-end smoke test driving the real packaged app (not a browser
// fallback) through Electron's own _electron launcher. Requires no other
// DineForge POS instance running — the app's single-instance lock (see
// main.js) would otherwise just focus that instance and this test would
// hang waiting for a window that never appears.
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Matches Electron's default userData path (app.getPath('userData')), which
// is based on package.json's "name" field, not electron-builder's
// productName — confirmed by inspecting a real dev run's actual DB location.
const DB_FILE = path.join(process.env.APPDATA, 'dineforge-pos-shell', 'data', 'dineforge.sqlite');

function resetDb() {
  for (const suffix of ['', '-shm', '-wal']) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

test.describe('DineForge POS smoke test', () => {
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
    await expect(window).toHaveTitle('DineForge POS');
  });

  test('first-run setup wizard walks through to the main app', async () => {
    await expect(window.locator('#setupWizard')).not.toBeEmpty();

    await window.locator('#wName').fill('E2E Restaurant');
    await window.getByRole('button', { name: 'Next' }).click();

    await window.getByRole('button', { name: 'Next' }).click(); // business details step, defaults fine

    await window.getByRole('button', { name: 'Next' }).click(); // tax step, defaults fine

    await window.getByRole('button', { name: 'Next' }).click(); // optional step, skip

    await window.getByRole('button', { name: 'Start blank' }).click();

    // Everyone signs in with a role after setup, including the local
    // terminal — no PIN was configured for Admin during the wizard above, so
    // this is a one-click login. Admin has full access (waiter + kitchen +
    // admin), which is what the next test needs.
    await expect(window.locator('#roleLogin')).not.toBeEmpty();
    await window.locator('.role-btn[data-role="admin"]').click();
    await window.getByRole('button', { name: 'Sign In' }).click();

    await expect(window.locator('#roleLogin')).toBeEmpty();
    await expect(window.getByRole('button', { name: 'New Order' })).toBeVisible();
  });

  test('full order lifecycle: create, add item, send to kitchen, pay, attempt receipt print', async () => {
    const apiBase = await window.evaluate(() => window.dineforge.getApiBase());
    // Reuses the admin session the previous test signed in with —
    // sessionStorage survives across tests in this same window/tab.
    const token = await window.evaluate(() => JSON.parse(sessionStorage.getItem('dineforge_session')).token);
    const authHeaders = { 'Content-Type': 'application/json', 'X-Session-Token': token };

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

    // The Order view cached menu/shift state at boot; reload to pick up seed data.
    await window.reload();
    await window.waitForLoadState('domcontentloaded');

    await window.getByRole('button', { name: 'New Order' }).click();
    await expect(window.locator('#orderLabel')).toContainText(/Order #\d{8}-\d{4}/);

    await window.getByRole('button', { name: 'E2E Burger' }).click();
    await expect(window.locator('.cart-totals')).toContainText('$9.99');

    await window.getByRole('button', { name: 'Send to Kitchen' }).click();
    await expect(window.locator('#orderLabel')).toContainText('sent to kitchen');

    // Sending to kitchen fires an automatic KOT print attempt — no printer is
    // configured in this test environment, so it fails gracefully (toast)
    // exactly like the receipt/cash-drawer attempts below, rather than
    // crashing or hanging the app.
    await expect(window.getByText(/Printer IP address is not configured/).first()).toBeVisible({ timeout: 8000 });

    // The manual reprint button hits the same code path and should be
    // enabled now that the order has sent (non-pending) items. It surfaces
    // the same "not configured" message from buildPrinter(), not a generic
    // fallback, since the backend call succeeds but reports failure.
    await window.getByRole('button', { name: 'Print KOT' }).click();
    await expect(window.getByText(/Printer IP address is not configured/).first()).toBeVisible({ timeout: 8000 });

    await window.getByRole('button', { name: 'Pay', exact: true }).click();
    await window.getByRole('button', { name: 'Confirm Payment' }).click();
    await expect(window.locator('#orderLabel')).toContainText('No order selected');

    // No printer is configured in this test environment. A cash payment
    // fires both an open-cash-drawer and a print-receipt attempt, each
    // failing independently and gracefully (toast) rather than hanging or
    // crashing the app — the printer connect timeout is ~4s.
    await expect(window.getByText(/Printer IP address is not configured/).first()).toBeVisible({ timeout: 8000 });
  });

  test('printer settings: USB connection type lists real installed printers', async () => {
    // This machine has real Windows printers installed (whatever's on the
    // test runner). We verify they're listed and that an unconfigured USB
    // printer fails gracefully — but deliberately never select one of the
    // real printers and print to it, since that could actually queue a job
    // on physical/virtual hardware attached to whoever runs this suite.
    await window.getByRole('button', { name: 'Admin', exact: true }).click();
    await window.getByRole('button', { name: 'Settings', exact: true }).click();

    await window.locator('input[name="printerConnection"][value="usb"]').check();
    await expect(window.locator('#printerDeviceRow')).toBeVisible();
    await expect(window.locator('#printerNetworkRow')).toBeHidden();

    const printerOptions = window.locator('#printerName option');
    await expect(printerOptions.first()).toBeAttached();
    expect(await printerOptions.count()).toBeGreaterThan(0);

    // Save with USB selected but no specific printer chosen, then confirm
    // Test Print reports the same kind of graceful "not configured" failure
    // as the network path does elsewhere in this suite — never an app crash.
    // #savePrinterBtn specifically: the Settings panel has more than one
    // button plainly labeled "Save" (general settings, printer, tax).
    await window.locator('#savePrinterBtn').click();
    await expect(window.getByText('Printer settings saved')).toBeVisible();

    await window.getByRole('button', { name: 'Test Print' }).click();
    await expect(window.getByText(/USB printer is not selected|Selected USB printer not found/).first()).toBeVisible({
      timeout: 8000,
    });

    // Leave settings back on Network so this test's ordering doesn't leak
    // into any future test added after it in this file.
    await window.locator('input[name="printerConnection"][value="network"]').check();
    await window.locator('#savePrinterBtn').click();
  });

  test('printing against a real reachable printer: no crash, correct content', async () => {
    // Every other test in this file only ever exercises the "no printer
    // configured" failure path — buildPrinter() throws before ever touching
    // the order object. That masked a real bug for the whole session: the
    // main process's internal fetchJson() (used to re-fetch the order/
    // settings/tables for a print job) never attached the caller's session
    // token, so GET /api/orders/{id} (role-guarded) 401ed and printKOT/
    // printReceipt crashed on the resulting error object instead of the
    // real order ("Cannot read properties of undefined (reading 'filter')").
    // A fake local TCP "printer" lets this test actually reach the success
    // path and prove the whole pipeline — auth included — works.
    let received = Buffer.alloc(0);
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk]);
      });
      socket.on('error', () => {});
    });
    const printerPort = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    try {
      const apiBase = await window.evaluate(() => window.dineforge.getApiBase());
      const token = await window.evaluate(() => JSON.parse(sessionStorage.getItem('dineforge_session')).token);
      const authHeaders = { 'Content-Type': 'application/json', 'X-Session-Token': token };

      await fetch(`${apiBase}/api/settings`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ printer_connection: 'network', printer_ip: '127.0.0.1', printer_port: String(printerPort) }),
      });

      await window.reload();
      await window.waitForLoadState('domcontentloaded');
      await window.getByRole('button', { name: 'New Order' }).click();
      await expect(window.locator('#orderLabel')).toContainText(/Order #\d{8}-\d{4}/);
      await window.getByRole('button', { name: 'E2E Burger' }).click();
      await expect(window.locator('.cart-totals')).toContainText('$9.99');

      await window.getByRole('button', { name: 'Send to Kitchen' }).click();
      await expect(window.locator('#orderLabel')).toContainText('sent to kitchen');

      // The auto KOT print above is fire-and-forget from the app's side, so
      // give it a moment, then confirm no error toast appeared and the
      // "printer" actually received bytes containing real order content.
      await window.waitForTimeout(1500);
      await expect(window.getByText(/Cannot read propert/i)).toHaveCount(0);
      expect(received.length).toBeGreaterThan(0);
      expect(received.toString('latin1')).toContain('E2E Burger');

      // Reset back to unconfigured so later runs of this same describe
      // block (or any future test appended after this one) still hit the
      // well-understood "not configured" path instead of this fake one.
      await fetch(`${apiBase}/api/settings`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ printer_ip: '', printer_port: '9100' }),
      });
    } finally {
      server.close();
    }
  });
});
