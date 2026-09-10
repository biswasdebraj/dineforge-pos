// Print path for ordinary Windows printers (laser, inkjet — anything that
// isn't a thermal receipt printer). printer.js's USB/network paths send raw
// ESC/POS command bytes straight to the spooler or a TCP socket; a standard
// printer's firmware doesn't understand that command language and silently
// discards it — no error, no page, which is exactly indistinguishable from
// "the feature doesn't exist" to whoever's staring at an empty output tray.
//
// This path instead renders the ticket as an actual HTML page and prints it
// through Electron's own Chromium print pipeline (BrowserWindow.print()),
// which goes through the real driver like any normal Windows print job —
// the same mechanism a browser uses to print a web page.
const { BrowserWindow } = require('electron');
const QRCode = require('qrcode');

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(cents, symbol) {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function pageShell(bodyHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 8mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 76mm; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big { font-size: 18px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row.total { font-size: 14px; }
  .mod { padding-left: 14px; color: #333; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  img.qr { display: block; margin: 6px auto; width: 35mm; height: 35mm; }
</style></head><body>${bodyHtml}</body></html>`;
}

async function buildReceiptHtml(settings, order) {
  const symbol = settings.currency_symbol || '$';
  const isComposite = settings.gst_scheme === 'composite';

  let html = `<div class="center bold big">${escapeHtml(settings.restaurant_name || 'DineForge POS')}</div>`;
  if (settings.restaurant_address) html += `<div class="center">${escapeHtml(settings.restaurant_address)}</div>`;
  if (settings.gstin) html += `<div class="center">GSTIN: ${escapeHtml(settings.gstin)}</div>`;
  html += `<div class="center">Order #${escapeHtml(order.order_number)}</div>`;
  if (order.customer_name) html += `<div class="center">Customer: ${escapeHtml(order.customer_name)}</div>`;
  html += `<div class="center">${escapeHtml(new Date(order.opened_at.replace(' ', 'T')).toLocaleString())}</div><hr>`;

  for (const item of order.items) {
    if (item.status === 'void') continue;
    html += `<div class="row"><span>${item.quantity}x ${escapeHtml(item.item_name)}</span><span>${money(item.unit_price_cents * item.quantity, symbol)}</span></div>`;
    for (const mod of item.modifiers) html += `<div class="mod">+ ${escapeHtml(mod.modifier_name)}</div>`;
  }

  html += '<hr>';
  html += `<div class="row"><span>Subtotal</span><span>${money(order.subtotal_cents, symbol)}</span></div>`;
  if (order.discount_total_cents) html += `<div class="row"><span>Discount</span><span>-${money(order.discount_total_cents, symbol)}</span></div>`;
  if (order.delivery_fee_cents) html += `<div class="row"><span>Delivery Fee</span><span>${money(order.delivery_fee_cents, symbol)}</span></div>`;
  if (order.packaging_fee_cents) html += `<div class="row"><span>Packaging Fee</span><span>${money(order.packaging_fee_cents, symbol)}</span></div>`;

  if (isComposite) {
    html += '<div>Composition taxable person, not eligible to collect tax on supplies.</div>';
  } else if (order.tax_total_cents) {
    const cgst = Math.round(order.tax_total_cents / 2);
    const sgst = order.tax_total_cents - cgst;
    html += `<div class="row"><span>CGST</span><span>${money(cgst, symbol)}</span></div>`;
    html += `<div class="row"><span>SGST</span><span>${money(sgst, symbol)}</span></div>`;
  }

  html += `<div class="row total bold"><span>Total</span><span>${money(order.total_cents, symbol)}</span></div>`;

  for (const payment of order.payments) {
    html += `<div class="row"><span>Paid (${escapeHtml(payment.method)})</span><span>${money(payment.amount_cents, symbol)}</span></div>`;
    if (payment.change_due_cents) html += `<div class="row"><span>Change</span><span>${money(payment.change_due_cents, symbol)}</span></div>`;
  }

  // Same reasoning as printer.js: only show "scan to pay" on a bill printed
  // before payment is recorded, never on a receipt for an already-paid order.
  if (settings.upi_id && order.status !== 'paid') {
    const upiParams = new URLSearchParams({
      pa: settings.upi_id,
      pn: settings.restaurant_name || 'DineForge POS',
      am: (order.total_cents / 100).toFixed(2),
      cu: 'INR',
      tn: `Order ${order.order_number}`,
    });
    const qrDataUrl = await QRCode.toDataURL(`upi://pay?${upiParams.toString()}`, { margin: 1, width: 240 });
    html += `<hr><div class="center">Scan to pay via UPI</div><img class="qr" src="${qrDataUrl}" alt="UPI QR" />`;
  }

  html += '<hr><div class="center">Thank you!</div>';
  return pageShell(html);
}

async function buildKotHtml(order, itemIds) {
  const items = order.items.filter((item) => item.status !== 'void' && (!itemIds || itemIds.includes(item.id)));
  if (items.length === 0) return null;

  let html = `<div class="center bold big">KITCHEN ORDER</div>`;
  const tableLabel = order.order_type === 'dine_in' && order.table_label ? ` &middot; ${escapeHtml(order.table_label)}` : '';
  html += `<div class="center">Order #${escapeHtml(order.order_number)}${tableLabel}</div>`;
  if (order.customer_name) html += `<div class="center">Customer: ${escapeHtml(order.customer_name)}</div>`;
  html += `<div class="center">${escapeHtml(new Date().toLocaleString())}</div><hr>`;

  for (const item of items) {
    html += `<div class="bold" style="font-size:16px;">${item.quantity}x ${escapeHtml(item.item_name)}</div>`;
    for (const mod of item.modifiers) html += `<div class="mod">+ ${escapeHtml(mod.modifier_name)}</div>`;
    if (item.notes) html += `<div class="mod">note: ${escapeHtml(item.notes)}</div>`;
  }

  return pageShell(html);
}

function printHtml(html, printerName) {
  return new Promise((resolve, reject) => {
    if (!printerName) {
      reject(new Error('No printer selected (Admin → Settings → Printer)'));
      return;
    }
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
    win.webContents.once('did-finish-load', () => {
      win.webContents.print({ silent: true, deviceName: printerName, margins: { marginType: 'none' } }, (success, errorType) => {
        win.close();
        if (success) resolve();
        else reject(new Error(errorType || 'Print failed'));
      });
    });
    win.webContents.once('did-fail-load', (event, code, description) => {
      win.close();
      reject(new Error(description || 'Could not render print page'));
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

async function testPrint(settings) {
  const html = pageShell(
    `<div class="center bold big">${escapeHtml(settings.restaurant_name || 'DineForge POS')}</div><div class="center">Test print OK</div><div class="center">${escapeHtml(new Date().toLocaleString())}</div>`
  );
  await printHtml(html, settings.printer_name);
  return { success: true, message: 'Test print sent' };
}

async function openCashDrawer() {
  return { success: false, message: 'Cash drawer kick is an ESC/POS feature — not available on a standard printer' };
}

async function printReceipt(settings, order) {
  const html = await buildReceiptHtml(settings, order);
  await printHtml(html, settings.printer_name);
  return { success: true };
}

async function printKOT(settings, order, itemIds) {
  const html = await buildKotHtml(order, itemIds);
  if (html === null) {
    return { success: false, message: 'Nothing to print — no items on this ticket' };
  }
  await printHtml(html, settings.printer_name);
  return { success: true };
}

module.exports = { testPrint, openCashDrawer, printReceipt, printKOT };
