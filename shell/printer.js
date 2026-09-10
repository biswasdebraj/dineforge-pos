const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function isUsb(settings) {
  return settings.printer_connection === 'usb';
}

// USB thermal printers are just ordinary Windows-installed printers (the
// vendor's own driver puts them there); we send raw ESC/POS bytes through
// the Win32 print spooler via a small PowerShell/P-Invoke helper rather than
// a node-gyp-built native module — no compiler toolchain needed on the
// machine that builds the installer, and nothing that can go stale against a
// particular Node/Electron ABI. See shell/scripts/print-raw.ps1.
function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => { stdout += d; });
    ps.stderr.on('data', (d) => { stderr += d; });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

async function listUsbPrinters() {
  const scriptPath = path.join(SCRIPTS_DIR, 'list-printers.ps1');
  const output = await runPowerShell(['-File', scriptPath]);
  return output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function sendRawToUsbPrinter(printerName, buffer) {
  const scriptPath = path.join(SCRIPTS_DIR, 'print-raw.ps1');
  const tempFile = path.join(os.tmpdir(), `dineforge-print-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tempFile, buffer);
  try {
    await runPowerShell(['-File', scriptPath, '-PrinterName', printerName, '-FilePath', tempFile]);
  } finally {
    fs.unlink(tempFile, () => {});
  }
}

function buildPrinter(settings) {
  const config = {
    type: settings.printer_type === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    width: Number(settings.printer_width) || 42,
  };

  if (isUsb(settings)) {
    if (!settings.printer_name) {
      throw new Error('USB printer is not selected (Admin → Settings → Printer)');
    }
    // No `interface` set — this printer is only ever used to build a buffer
    // (getBuffer()) which sendRawToUsbPrinter() delivers; execute() is never
    // called on it, so it doesn't need node-thermal-printer's own interface.
  } else {
    const ip = settings.printer_ip;
    if (!ip) {
      throw new Error('Printer IP address is not configured (Admin → Settings → Printer)');
    }
    const port = settings.printer_port || '9100';
    config.interface = `tcp://${ip}:${port}`;
    config.options = { timeout: 4000 };
  }

  return new ThermalPrinter(config);
}

async function isPrinterConnected(settings) {
  if (isUsb(settings)) {
    if (!settings.printer_name) return false;
    const names = await listUsbPrinters();
    return names.includes(settings.printer_name);
  }
  const printer = buildPrinter(settings);
  return printer.isPrinterConnected();
}

// Delivers whatever's been built up in `printer`'s buffer — network prints
// execute over the TCP interface node-thermal-printer already opened; USB
// prints hand the raw bytes to the spooler helper instead.
async function dispatch(settings, printer) {
  if (isUsb(settings)) {
    await sendRawToUsbPrinter(settings.printer_name, printer.getBuffer());
  } else {
    await printer.execute();
  }
}

function money(cents, symbol) {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

async function testPrint(settings) {
  const connected = await isPrinterConnected(settings);
  if (!connected) {
    return { success: false, message: isUsb(settings) ? 'Selected USB printer not found' : 'Printer not reachable at that address' };
  }

  const printer = buildPrinter(settings);
  printer.alignCenter();
  printer.bold(true);
  printer.println(settings.restaurant_name || 'DineForge POS');
  printer.bold(false);
  printer.println('Test print OK');
  printer.println(new Date().toLocaleString());
  printer.cut();
  await dispatch(settings, printer);

  return { success: true, message: 'Test print sent' };
}

async function openCashDrawer(settings) {
  const printer = buildPrinter(settings);
  printer.openCashDrawer();
  await dispatch(settings, printer);
  return { success: true };
}

async function printReceipt(settings, order) {
  const printer = buildPrinter(settings);
  const symbol = settings.currency_symbol || '$';

  const isComposite = settings.gst_scheme === 'composite';

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(settings.restaurant_name || 'DineForge POS');
  printer.setTextNormal();
  printer.bold(false);
  if (settings.restaurant_address) {
    printer.println(settings.restaurant_address);
  }
  if (settings.gstin) {
    printer.println(`GSTIN: ${settings.gstin}`);
  }
  printer.println(`Order #${order.order_number}`);
  if (order.customer_name) {
    printer.println(`Customer: ${order.customer_name}`);
  }
  printer.println(new Date(order.opened_at.replace(' ', 'T')).toLocaleString());
  printer.drawLine();

  printer.alignLeft();
  for (const item of order.items) {
    if (item.status === 'void') continue;
    printer.leftRight(`${item.quantity}x ${item.item_name}`, money(item.unit_price_cents * item.quantity, symbol));
    for (const mod of item.modifiers) {
      printer.println(`   + ${mod.modifier_name}`);
    }
  }

  printer.drawLine();
  printer.leftRight('Subtotal', money(order.subtotal_cents, symbol));
  if (order.discount_total_cents) {
    printer.leftRight('Discount', `-${money(order.discount_total_cents, symbol)}`);
  }
  if (order.delivery_fee_cents) {
    printer.leftRight('Delivery Fee', money(order.delivery_fee_cents, symbol));
  }
  if (order.packaging_fee_cents) {
    printer.leftRight('Packaging Fee', money(order.packaging_fee_cents, symbol));
  }
  if (isComposite) {
    // Composition-scheme dealers cannot charge tax separately to the
    // customer — item prices are already tax-inclusive, so no tax line, and
    // the law requires this exact disclaimer on the invoice instead.
    printer.setTextNormal();
    printer.println('Composition taxable person,');
    printer.println('not eligible to collect tax');
    printer.println('on supplies.');
  } else if (order.tax_total_cents) {
    // Split evenly rather than recomputing from a rate — always sums back
    // to the stored total exactly, even when the tax is an odd number of
    // paisa/cents.
    const cgst = Math.round(order.tax_total_cents / 2);
    const sgst = order.tax_total_cents - cgst;
    printer.leftRight(`CGST`, money(cgst, symbol));
    printer.leftRight(`SGST`, money(sgst, symbol));
  }
  printer.bold(true);
  printer.leftRight('Total', money(order.total_cents, symbol));
  printer.bold(false);

  for (const payment of order.payments) {
    printer.leftRight(`Paid (${payment.method})`, money(payment.amount_cents, symbol));
    if (payment.change_due_cents) {
      printer.leftRight('Change', money(payment.change_due_cents, symbol));
    }
  }

  if (settings.upi_id) {
    // Standard UPI deep-link scheme (pa=payee VPA, am=amount, cu=currency,
    // tn=note) — any UPI app pre-fills the exact amount from this, so the
    // customer only has to confirm and authenticate, never type a number.
    const upiParams = new URLSearchParams({
      pa: settings.upi_id,
      pn: settings.restaurant_name || 'DineForge POS',
      am: (order.total_cents / 100).toFixed(2),
      cu: 'INR',
      tn: `Order ${order.order_number}`,
    });
    printer.alignCenter();
    printer.println('');
    printer.println('Scan to pay via UPI');
    printer.printQR(`upi://pay?${upiParams.toString()}`, { cellSize: 6, correction: 'M' });
  }

  printer.drawLine();
  printer.alignCenter();
  printer.println('Thank you!');
  printer.cut();

  await dispatch(settings, printer);
  return { success: true };
}

async function printKOT(settings, order, itemIds) {
  const printer = buildPrinter(settings);

  const items = order.items.filter((item) => item.status !== 'void' && (!itemIds || itemIds.includes(item.id)));
  if (items.length === 0) {
    return { success: false, message: 'Nothing to print — no items on this ticket' };
  }

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println('KITCHEN ORDER');
  printer.setTextNormal();
  printer.bold(false);
  const tableLabel = order.order_type === 'dine_in' && order.table_label ? ` · ${order.table_label}` : '';
  printer.println(`Order #${order.order_number}${tableLabel}`);
  if (order.customer_name) {
    printer.println(`Customer: ${order.customer_name}`);
  }
  printer.println(new Date().toLocaleString());
  printer.drawLine();

  printer.alignLeft();
  printer.setTextDoubleHeight();
  for (const item of items) {
    printer.println(`${item.quantity}x ${item.item_name}`);
    printer.setTextNormal();
    for (const mod of item.modifiers) {
      printer.println(`   + ${mod.modifier_name}`);
    }
    if (item.notes) {
      printer.println(`   note: ${item.notes}`);
    }
    printer.setTextDoubleHeight();
  }
  printer.setTextNormal();

  printer.cut();
  await dispatch(settings, printer);
  return { success: true };
}

module.exports = { testPrint, openCashDrawer, printReceipt, printKOT, listUsbPrinters };
