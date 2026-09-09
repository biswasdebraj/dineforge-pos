const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

function buildPrinter(settings) {
  const ip = settings.printer_ip;
  if (!ip) {
    throw new Error('Printer IP address is not configured (Admin → Settings → Printer)');
  }

  const port = settings.printer_port || '9100';
  return new ThermalPrinter({
    type: settings.printer_type === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: `tcp://${ip}:${port}`,
    width: Number(settings.printer_width) || 42,
    options: { timeout: 4000 },
  });
}

function money(cents, symbol) {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

async function testPrint(settings) {
  const printer = buildPrinter(settings);
  const connected = await printer.isPrinterConnected();
  if (!connected) {
    return { success: false, message: 'Printer not reachable at that address' };
  }

  printer.alignCenter();
  printer.bold(true);
  printer.println(settings.restaurant_name || 'DineForge POS');
  printer.bold(false);
  printer.println('Test print OK');
  printer.println(new Date().toLocaleString());
  printer.cut();
  await printer.execute();

  return { success: true, message: 'Test print sent' };
}

async function openCashDrawer(settings) {
  const printer = buildPrinter(settings);
  printer.openCashDrawer();
  await printer.execute();
  return { success: true };
}

async function printReceipt(settings, order) {
  const printer = buildPrinter(settings);
  const symbol = settings.currency_symbol || '$';

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(settings.restaurant_name || 'DineForge POS');
  printer.setTextNormal();
  printer.bold(false);
  printer.println(`Order #${order.order_number}`);
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
  printer.leftRight('Tax', money(order.tax_total_cents, symbol));
  printer.bold(true);
  printer.leftRight('Total', money(order.total_cents, symbol));
  printer.bold(false);

  for (const payment of order.payments) {
    printer.leftRight(`Paid (${payment.method})`, money(payment.amount_cents, symbol));
    if (payment.change_due_cents) {
      printer.leftRight('Change', money(payment.change_due_cents, symbol));
    }
  }

  printer.drawLine();
  printer.alignCenter();
  printer.println('Thank you!');
  printer.cut();

  await printer.execute();
  return { success: true };
}

module.exports = { testPrint, openCashDrawer, printReceipt };
