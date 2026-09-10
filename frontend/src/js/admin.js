import { api, toast, escapeHtml, CURRENCIES, money, showModal, closeModal, apiUrl, getSession } from './api.js';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderLanConnect(box) {
  if (!window.dineforge?.getLanInfo) {
    box.innerHTML = '<div class="empty-hint">Only available in the desktop app, not a browser tab.</div>';
    return;
  }

  let info;
  try {
    info = await window.dineforge.getLanInfo();
  } catch (err) {
    box.innerHTML = `<div class="empty-hint">Could not determine LAN address: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!info.available) {
    box.innerHTML = '<div class="empty-hint">No network connection found — connect this computer to Wi-Fi or Ethernet to allow other devices to sign in.</div>';
    return;
  }

  box.innerHTML = `
    <div style="display:flex; gap:1rem; align-items:center;">
      <img src="${info.qrDataUrl}" alt="QR code" width="160" height="160" style="border-radius:8px;" />
      <div>
        <p class="empty-hint" style="margin:0 0 0.5rem;">Scan with a phone or tablet on the same Wi-Fi to sign in as Waiter or Kitchen from that device.</p>
        <code>${escapeHtml(info.url)}</code>
      </div>
    </div>
  `;
}

let root = null;
let categories = [];
let items = [];
let tables = [];
let settings = {};
let taxes = [];
let backups = [];
let roleStatus = { waiter: false, kitchen: false, admin: false };

export async function init(container) {
  root = container;
  root.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="menu">Menu</button>
      <button class="admin-tab" data-tab="tables">Tables</button>
      <button class="admin-tab" data-tab="reports">Reports</button>
      <button class="admin-tab" data-tab="settings">Settings</button>
    </div>
    <div class="admin-panel active" id="admin-menu"></div>
    <div class="admin-panel" id="admin-tables"></div>
    <div class="admin-panel" id="admin-reports"></div>
    <div class="admin-panel" id="admin-settings"></div>
  `;

  root.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('active', b === btn));
      root.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('active', p.id === `admin-${btn.dataset.tab}`));
    });
  });

  await refresh();
}

export async function refresh() {
  if (!root) return;
  [categories, items, tables, settings, taxes, backups, roleStatus] = await Promise.all([
    api.categories.list(),
    api.items.list(),
    api.tables.list(),
    api.settings.get(),
    api.taxes.list(),
    api.backups.list(),
    api.auth.status(),
  ]);
  renderMenu();
  renderTables();
  renderReports();
  renderSettings();
}

async function renderMenu() {
  const panel = root.querySelector('#admin-menu');
  const apiBase = await apiUrl('');
  panel.innerHTML = `
    <div class="section-title">Import Menu from Excel</div>
    <div class="form-row">
      <a href="#" id="downloadTemplateLink">Download template (.xlsx)</a>
    </div>
    <div class="form-row">
      <input id="menuImportFile" type="file" accept=".xlsx" />
      <button class="btn primary" id="menuImportBtn">Import</button>
    </div>
    <div class="empty-hint">Columns: Category, Item Name, Price, Description (optional), SKU (optional). Re-importing updates items already matching by category + name instead of duplicating them.</div>

    <div class="section-title">Categories</div>
    <table class="data-table">
      <thead><tr><th>Name</th><th>Sort</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${categories
          .map(
            (c) => `
          <tr data-id="${c.id}">
            <td><input class="cat-name" value="${escapeHtml(c.name)}" /></td>
            <td><input class="cat-sort" type="number" value="${c.sort_order}" style="width:60px" /></td>
            <td><input class="cat-active" type="checkbox" ${c.is_active ? 'checked' : ''} /></td>
            <td>
              <button class="inline-btn cat-save">Save</button>
              <button class="inline-btn danger cat-delete">Delete</button>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div class="form-row">
      <input id="newCatName" type="text" placeholder="New category name" />
      <button class="btn" id="newCatBtn">Add Category</button>
    </div>

    <div class="section-title">Menu Items</div>
    <table class="data-table">
      <thead><tr><th>Image</th><th>Name</th><th>Category</th><th>Price</th><th>SKU / Barcode</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${items
          .map(
            (i) => `
          <tr data-id="${i.id}">
            <td>
              ${i.image_path ? `<img class="item-thumb" src="${apiBase}/api/menu/images/${i.image_path}" alt="" />` : '<span class="empty-hint">None</span>'}
              <input type="file" class="item-image-input" accept=".jpg,.jpeg,.png,.webp" hidden />
              <button class="inline-btn item-image-upload" type="button">${i.image_path ? 'Change' : 'Add'}</button>
              ${i.image_path ? '<button class="inline-btn danger item-image-remove" type="button">Remove</button>' : ''}
            </td>
            <td><input class="item-name" value="${escapeHtml(i.name)}" /></td>
            <td>
              <select class="item-category">
                ${categories.map((c) => `<option value="${c.id}" ${c.id === i.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </td>
            <td><input class="item-price" type="number" min="0" step="0.01" value="${(i.price_cents / 100).toFixed(2)}" style="width:80px" /></td>
            <td><input class="item-sku" value="${escapeHtml(i.sku || '')}" placeholder="scan or type" style="width:110px" /></td>
            <td><input class="item-active" type="checkbox" ${i.is_active ? 'checked' : ''} /></td>
            <td>
              <button class="inline-btn item-save">Save</button>
              <button class="inline-btn danger item-delete">Delete</button>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div class="form-row">
      <input id="newItemName" type="text" placeholder="New item name" />
      <select id="newItemCategory">
        ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <input id="newItemPrice" type="number" min="0" step="0.01" placeholder="Price" style="width:100px" />
      <input id="newItemSku" type="text" placeholder="SKU / barcode (optional)" style="width:150px" />
      <button class="btn" id="newItemBtn">Add Item</button>
    </div>
  `;

  panel.querySelectorAll('tr[data-id]').forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('.cat-save')?.addEventListener('click', () =>
      saveCategory(id, {
        name: row.querySelector('.cat-name').value.trim(),
        sort_order: Number(row.querySelector('.cat-sort').value),
        is_active: row.querySelector('.cat-active').checked,
      })
    );
    row.querySelector('.cat-delete')?.addEventListener('click', () => deleteCategory(id));
    row.querySelector('.item-save')?.addEventListener('click', () =>
      saveItem(id, {
        name: row.querySelector('.item-name').value.trim(),
        category_id: Number(row.querySelector('.item-category').value),
        price_cents: Math.round(parseFloat(row.querySelector('.item-price').value || '0') * 100),
        sku: row.querySelector('.item-sku').value.trim() || null,
        is_active: row.querySelector('.item-active').checked,
      })
    );
    row.querySelector('.item-delete')?.addEventListener('click', () => deleteItem(id));

    const imageInput = row.querySelector('.item-image-input');
    row.querySelector('.item-image-upload')?.addEventListener('click', () => imageInput.click());
    imageInput?.addEventListener('change', async () => {
      const file = imageInput.files[0];
      if (!file) return;
      try {
        await api.items.uploadImage(id, file);
        await refresh();
        toast('Image updated');
      } catch (err) {
        toast(err.message, true);
      }
    });
    row.querySelector('.item-image-remove')?.addEventListener('click', async () => {
      try {
        await api.items.removeImage(id);
        await refresh();
        toast('Image removed');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  panel.querySelector('#downloadTemplateLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const url = await apiUrl('/api/menu/template');
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dineforge-menu-template.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  panel.querySelector('#menuImportBtn').addEventListener('click', async () => {
    const fileInput = panel.querySelector('#menuImportFile');
    const file = fileInput.files[0];
    if (!file) {
      toast('Choose a file first', true);
      return;
    }
    try {
      const result = await api.menuImport(file);
      await refresh();
      const parts = [`${result.created} created`, `${result.updated} updated`];
      if (result.errors.length) parts.push(`${result.errors.length} row(s) skipped`);
      toast(parts.join(', '), result.errors.length > 0);
      if (result.errors.length) {
        console.warn('Menu import errors:', result.errors);
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#newCatBtn').addEventListener('click', async () => {
    const nameInput = panel.querySelector('#newCatName');
    if (!nameInput.value.trim()) return;
    try {
      await api.categories.create({ name: nameInput.value.trim() });
      await refresh();
      toast('Category added');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#newItemBtn').addEventListener('click', async () => {
    const name = panel.querySelector('#newItemName').value.trim();
    const categoryId = Number(panel.querySelector('#newItemCategory').value);
    const price = parseFloat(panel.querySelector('#newItemPrice').value || '0');
    const sku = panel.querySelector('#newItemSku').value.trim() || undefined;
    if (!name || !categoryId || price < 0) {
      toast('Enter a name, category, and price', true);
      return;
    }
    try {
      await api.items.create({ name, category_id: categoryId, price_cents: Math.round(price * 100), sku });
      await refresh();
      toast('Item added');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function saveCategory(id, body) {
  try {
    await api.categories.update(id, body);
    await refresh();
    toast('Category saved');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteCategory(id) {
  if (!window.confirm('Delete this category?')) return;
  try {
    await api.categories.remove(id);
    await refresh();
    toast('Category deleted');
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveItem(id, body) {
  try {
    await api.items.update(id, body);
    await refresh();
    toast('Item saved');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteItem(id) {
  if (!window.confirm('Delete this item?')) return;
  try {
    await api.items.remove(id);
    await refresh();
    toast('Item deleted');
  } catch (err) {
    toast(err.message, true);
  }
}

function renderTables() {
  const panel = root.querySelector('#admin-tables');
  panel.innerHTML = `
    <div class="section-title">Dining Tables</div>
    <table class="data-table">
      <thead><tr><th>Label</th><th>Seats</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${tables
          .map(
            (t) => `
          <tr data-id="${t.id}">
            <td><input class="tbl-label" value="${escapeHtml(t.label)}" /></td>
            <td><input class="tbl-seats" type="number" min="1" value="${t.seats}" style="width:60px" /></td>
            <td>
              <select class="tbl-status">
                <option value="free" ${t.status === 'free' ? 'selected' : ''}>Free</option>
                <option value="occupied" ${t.status === 'occupied' ? 'selected' : ''}>Occupied</option>
                <option value="reserved" ${t.status === 'reserved' ? 'selected' : ''}>Reserved</option>
              </select>
            </td>
            <td><button class="inline-btn tbl-save">Save</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div class="form-row">
      <input id="newTableLabel" type="text" placeholder="Table label (e.g. T1)" />
      <input id="newTableSeats" type="number" min="1" value="2" style="width:70px" />
      <button class="btn" id="newTableBtn">Add Table</button>
    </div>
  `;

  panel.querySelectorAll('tr[data-id]').forEach((row) => {
    const id = Number(row.dataset.id);
    row.querySelector('.tbl-save').addEventListener('click', async () => {
      try {
        await api.tables.update(id, {
          label: row.querySelector('.tbl-label').value.trim(),
          seats: Number(row.querySelector('.tbl-seats').value),
          status: row.querySelector('.tbl-status').value,
        });
        await refresh();
        toast('Table saved');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  panel.querySelector('#newTableBtn').addEventListener('click', async () => {
    const label = panel.querySelector('#newTableLabel').value.trim();
    const seats = Number(panel.querySelector('#newTableSeats').value);
    if (!label) return;
    try {
      await api.tables.create({ label, seats });
      await refresh();
      toast('Table added');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function renderReports() {
  const panel = root.querySelector('#admin-reports');
  const today = new Date().toISOString().slice(0, 10);
  const symbol = settings.currency_symbol || '$';

  panel.innerHTML = `
    <div class="section-title">Daily Sales</div>
    <div class="form-row">
      <input id="salesDate" type="date" value="${today}" />
    </div>
    <div id="salesReportBox">Loading…</div>

    <div class="section-title">Order History</div>
    <div class="form-row">
      <input id="histDateFrom" type="date" />
      <input id="histDateTo" type="date" />
      <select id="histStatus">
        <option value="">Any status</option>
        <option value="open">Open</option>
        <option value="sent_to_kitchen">Sent to Kitchen</option>
        <option value="paid">Paid</option>
        <option value="void">Void</option>
      </select>
      <select id="histType">
        <option value="">Any type</option>
        <option value="dine_in">Dine-in</option>
        <option value="takeaway">Takeaway</option>
        <option value="delivery">Delivery</option>
      </select>
      <button class="btn primary" id="histSearchBtn">Search</button>
    </div>
    <div id="orderHistoryBox"></div>
  `;

  async function loadSalesReport() {
    const date = panel.querySelector('#salesDate').value;
    const box = panel.querySelector('#salesReportBox');
    box.textContent = 'Loading…';
    try {
      const r = await api.reports.dailySales(date);
      box.innerHTML = `
        <div class="report-grid">
          <div class="report-card"><div class="report-label">Orders</div><div class="report-value">${r.order_count}</div></div>
          <div class="report-card"><div class="report-label">Subtotal</div><div class="report-value">${money(r.subtotal_cents, symbol)}</div></div>
          <div class="report-card"><div class="report-label">Discounts</div><div class="report-value">-${money(r.discount_total_cents, symbol)}</div></div>
          <div class="report-card"><div class="report-label">Delivery + Packaging</div><div class="report-value">${money(r.delivery_fee_cents + r.packaging_fee_cents, symbol)}</div></div>
          <div class="report-card"><div class="report-label">Tax</div><div class="report-value">${money(r.tax_total_cents, symbol)}</div></div>
          <div class="report-card"><div class="report-label">Total</div><div class="report-value">${money(r.total_cents, symbol)}</div></div>
        </div>
        <div class="empty-hint" style="margin-top:0.5rem;">
          Cash ${money(r.by_payment_method.cash, symbol)} &middot; Card ${money(r.by_payment_method.card, symbol)} &middot; Other ${money(r.by_payment_method.other, symbol)}
          &nbsp;|&nbsp;
          Dine-in ${money(r.by_order_type.dine_in, symbol)} &middot; Takeaway ${money(r.by_order_type.takeaway, symbol)} &middot; Delivery ${money(r.by_order_type.delivery, symbol)}
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div class="empty-hint">${escapeHtml(err.message)}</div>`;
    }
  }

  panel.querySelector('#salesDate').addEventListener('change', loadSalesReport);
  loadSalesReport();

  async function loadOrderHistory() {
    const box = panel.querySelector('#orderHistoryBox');
    box.textContent = 'Loading…';
    try {
      const results = await api.orders.search({
        date_from: panel.querySelector('#histDateFrom').value,
        date_to: panel.querySelector('#histDateTo').value,
        status: panel.querySelector('#histStatus').value,
        order_type: panel.querySelector('#histType').value,
      });
      if (results.length === 0) {
        box.innerHTML = '<div class="empty-hint">No orders match.</div>';
        return;
      }
      box.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Order #</th><th>Date</th><th>Type</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${results
              .map(
                (o) => `
              <tr>
                <td>${escapeHtml(o.order_number)}</td>
                <td>${escapeHtml(o.opened_at)}</td>
                <td>${escapeHtml(o.order_type)}</td>
                <td>${escapeHtml(o.status.replace(/_/g, ' '))}</td>
                <td>${money(o.total_cents, symbol)}</td>
                <td><a href="#" data-view-order="${o.id}">View</a></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      box.querySelectorAll('[data-view-order]').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          showOrderDetail(Number(link.dataset.viewOrder));
        });
      });
    } catch (err) {
      box.innerHTML = `<div class="empty-hint">${escapeHtml(err.message)}</div>`;
    }
  }

  panel.querySelector('#histSearchBtn').addEventListener('click', loadOrderHistory);
  loadOrderHistory();
}

async function showOrderDetail(orderId) {
  const symbol = settings.currency_symbol || '$';
  let order;
  try {
    order = await api.orders.get(orderId);
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const itemRows = order.items
    .map(
      (item) => `
      <div class="row${item.status === 'void' ? '' : ''}">
        <span>${item.quantity}x ${escapeHtml(item.item_name)}${item.status === 'void' ? ' (void)' : ''}</span>
        <span>${money(item.unit_price_cents * item.quantity, symbol)}</span>
      </div>
    `
    )
    .join('');

  const paymentRows = order.payments
    .map((p) => `<div class="row"><span>Paid (${escapeHtml(p.method)})</span><span>${money(p.amount_cents, symbol)}</span></div>`)
    .join('');

  showModal(
    `
    <h2>Order #${escapeHtml(order.order_number)}</h2>
    <p class="empty-hint">${escapeHtml(order.order_type)} &middot; ${escapeHtml(order.status.replace(/_/g, ' '))} &middot; ${escapeHtml(order.opened_at)}</p>
    ${order.customer_name ? `<p class="empty-hint">Customer: ${escapeHtml(order.customer_name)}</p>` : ''}
    <div class="cart-totals">
      ${itemRows}
      <hr />
      <div class="row"><span>Subtotal</span><span>${money(order.subtotal_cents, symbol)}</span></div>
      ${order.discount_total_cents ? `<div class="row"><span>Discount</span><span>-${money(order.discount_total_cents, symbol)}</span></div>` : ''}
      ${order.delivery_fee_cents ? `<div class="row"><span>Delivery Fee</span><span>${money(order.delivery_fee_cents, symbol)}</span></div>` : ''}
      ${order.packaging_fee_cents ? `<div class="row"><span>Packaging Fee</span><span>${money(order.packaging_fee_cents, symbol)}</span></div>` : ''}
      <div class="row"><span>Tax</span><span>${money(order.tax_total_cents, symbol)}</span></div>
      <div class="row total"><span>Total</span><span>${money(order.total_cents, symbol)}</span></div>
      ${paymentRows}
    </div>
    <div class="modal-actions">
      <button class="btn primary" id="orderDetailClose">Close</button>
    </div>
  `,
    (modal) => {
      modal.querySelector('#orderDetailClose').addEventListener('click', closeModal);
    }
  );
}

function renderSettings() {
  const panel = root.querySelector('#admin-settings');
  const defaultTax = taxes.find((t) => t.is_default) || taxes[0];

  panel.innerHTML = `
    <div class="section-title">Restaurant</div>
    <div class="form-row">
      <input id="setName" type="text" value="${escapeHtml(settings.restaurant_name || '')}" placeholder="Restaurant name" />
      <select id="setCurrency" style="width:200px;">
        ${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === (settings.currency || 'USD') ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <input id="setAddress" type="text" value="${escapeHtml(settings.restaurant_address || '')}" placeholder="Address (printed on receipts)" />
    </div>
    <div class="form-row">
      <input id="setGstin" type="text" value="${escapeHtml(settings.gstin || '')}" placeholder="GSTIN / Tax Registration No." style="width:220px" />
      <select id="setGstScheme" style="width:200px;">
        <option value="regular" ${settings.gst_scheme !== 'composite' ? 'selected' : ''}>Regular GST</option>
        <option value="composite" ${settings.gst_scheme === 'composite' ? 'selected' : ''}>Composite GST</option>
      </select>
      <button class="btn primary" id="saveSettingsBtn">Save</button>
    </div>
    <div class="empty-hint">Regular: tax is itemized as CGST + SGST on receipts. Composite: prices are tax-inclusive, no tax line, disclaimer printed instead.</div>

    <div class="section-title">Tax</div>
    <div class="form-row">
      <input id="taxName" type="text" value="${escapeHtml(defaultTax?.name || '')}" placeholder="Tax name" />
      <input id="taxRate" type="number" min="0" step="0.01" value="${defaultTax?.rate_percent ?? 0}" placeholder="Rate %" style="width:100px" />
      <button class="btn primary" id="saveTaxBtn">Save Tax</button>
    </div>
    <div class="empty-hint">This rate applies automatically to every order's subtotal after discounts. Ignored entirely under Composite GST.</div>

    <div class="section-title">Delivery &amp; Packaging Charges</div>
    <div class="form-row">
      <input id="setDeliveryFee" type="number" min="0" step="0.01" value="${((settings.delivery_fee_default_cents || 0) / 100).toFixed(2)}" placeholder="Delivery fee" style="width:120px" />
      <input id="setPackagingFee" type="number" min="0" step="0.01" value="${((settings.packaging_fee_default_cents || 0) / 100).toFixed(2)}" placeholder="Packaging fee" style="width:120px" />
      <button class="btn primary" id="saveChargesBtn">Save</button>
    </div>
    <div class="empty-hint">Delivery orders get both charges by default; takeaway gets packaging only; dine-in gets neither. Staff can still adjust either on a specific order.</div>

    <div class="section-title">UPI Payment</div>
    <div class="form-row">
      <input id="setUpiId" type="text" value="${escapeHtml(settings.upi_id || '')}" placeholder="UPI ID, e.g. restaurant@okhdfcbank" style="width:260px" />
      <button class="btn primary" id="saveUpiBtn">Save</button>
    </div>
    <div class="empty-hint">When set, receipts print a UPI QR code pre-filled with the exact amount due — the customer scans and pays without typing anything.</div>

    <div class="section-title">Receipt Printer</div>
    <div class="form-row" style="flex-direction:row;align-items:center;gap:1rem;">
      <label style="margin:0;"><input type="radio" name="printerConnection" value="network" ${settings.printer_connection !== 'usb' ? 'checked' : ''} /> Network</label>
      <label style="margin:0;"><input type="radio" name="printerConnection" value="usb" ${settings.printer_connection === 'usb' ? 'checked' : ''} /> USB</label>
    </div>
    <div class="form-row" id="printerNetworkRow">
      <input id="printerIp" type="text" value="${escapeHtml(settings.printer_ip || '')}" placeholder="Printer IP address" style="width:160px" />
      <input id="printerPort" type="text" value="${escapeHtml(settings.printer_port || '9100')}" placeholder="Port" style="width:80px" />
    </div>
    <div class="form-row" id="printerUsbRow" hidden>
      <select id="printerName" style="min-width:220px;"><option value="">Loading…</option></select>
      <button class="btn" id="refreshPrintersBtn" type="button">Refresh</button>
    </div>
    <div class="form-row">
      <select id="printerType">
        <option value="epson" ${settings.printer_type !== 'star' ? 'selected' : ''}>Epson-compatible</option>
        <option value="star" ${settings.printer_type === 'star' ? 'selected' : ''}>Star</option>
      </select>
      <button class="btn primary" id="savePrinterBtn">Save</button>
    </div>
    <div class="form-row">
      <button class="btn" id="testPrintBtn">Test Print</button>
      <button class="btn" id="openDrawerBtn">Open Cash Drawer</button>
    </div>
    <div class="empty-hint">Network (Ethernet/Wi-Fi) ESC/POS printers, e.g. 192.168.1.50, or a USB thermal printer already installed in Windows. Only available in the desktop app, not a browser tab.</div>

    <div class="section-title">Backups</div>
    <div class="form-row">
      <button class="btn primary" id="backupNowBtn">Backup Now</button>
    </div>
    ${
      backups.length === 0
        ? '<div class="empty-hint">No backups yet. One is also taken automatically whenever a shift is closed.</div>'
        : `<table class="data-table">
             <thead><tr><th>File</th><th>Size</th><th>Created</th></tr></thead>
             <tbody>
               ${backups
                 .map(
                   (b) => `
                 <tr>
                   <td>${escapeHtml(b.filename)}</td>
                   <td>${formatBytes(b.size_bytes)}</td>
                   <td>${new Date(b.created_at).toLocaleString()}</td>
                 </tr>`
                 )
                 .join('')}
             </tbody>
           </table>`
    }

    <div class="section-title">Staff PINs</div>
    <div class="empty-hint">Everyone signs in with a role (Waiter/Kitchen/Admin). A role with no PIN set signs in with just a click — set one here to require it.</div>
    ${['waiter', 'kitchen', 'admin']
      .map((role) => {
        const label = role[0].toUpperCase() + role.slice(1);
        const hasPin = roleStatus[role];
        return `
        <div class="form-row" data-role="${role}">
          <strong style="width:80px">${label}</strong>
          <span class="empty-hint" style="width:110px">${hasPin ? 'PIN set' : 'No PIN'}</span>
          <input class="role-pin-new" type="password" inputmode="numeric" autocomplete="off" placeholder="New PIN" style="width:110px" />
          <button class="btn primary role-pin-save">${hasPin ? 'Change' : 'Set'} PIN</button>
          ${hasPin ? '<button class="btn danger role-pin-remove">Remove</button>' : ''}
        </div>`;
      })
      .join('')}

    <div class="section-title">Connect a Device</div>
    <div id="lanConnectBox">
      <div class="empty-hint">Loading…</div>
    </div>
  `;

  renderLanConnect(panel.querySelector('#lanConnectBox'));

  panel.querySelector('#backupNowBtn').addEventListener('click', async () => {
    try {
      await api.backups.create();
      await refresh();
      toast('Backup created');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelectorAll('[data-role]').forEach((row) => {
    const role = row.dataset.role;
    row.querySelector('.role-pin-save').addEventListener('click', async () => {
      const pin = row.querySelector('.role-pin-new').value;
      if (pin.length < 4) {
        toast('PIN must be at least 4 digits', true);
        return;
      }
      try {
        await api.auth.setPin(role, pin);
        await refresh();
        toast(`${role} PIN saved`);
      } catch (err) {
        toast(err.message, true);
      }
    });
    row.querySelector('.role-pin-remove')?.addEventListener('click', async () => {
      if (!window.confirm(`Remove the ${role} PIN? That role will sign in with just a click.`)) return;
      try {
        await api.auth.setPin(role, null);
        await refresh();
        toast(`${role} PIN removed`);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  const printerNetworkRow = panel.querySelector('#printerNetworkRow');
  const printerUsbRow = panel.querySelector('#printerUsbRow');
  const printerNameSelect = panel.querySelector('#printerName');

  function updatePrinterConnectionRows() {
    const usb = panel.querySelector('input[name="printerConnection"]:checked').value === 'usb';
    printerNetworkRow.hidden = usb;
    printerUsbRow.hidden = !usb;
  }
  panel.querySelectorAll('input[name="printerConnection"]').forEach((radio) => {
    radio.addEventListener('change', updatePrinterConnectionRows);
  });
  updatePrinterConnectionRows();

  async function refreshUsbPrinters() {
    if (!window.dineforge?.listUsbPrinters) {
      printerNameSelect.innerHTML = '<option value="">Only available in the desktop app</option>';
      return;
    }
    printerNameSelect.innerHTML = '<option value="">Loading…</option>';
    const names = await window.dineforge.listUsbPrinters();
    const current = settings.printer_name || '';
    printerNameSelect.innerHTML = names.length
      ? names.map((n) => `<option value="${escapeHtml(n)}" ${n === current ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
      : '<option value="">No printers found</option>';
  }
  panel.querySelector('#refreshPrintersBtn').addEventListener('click', refreshUsbPrinters);
  refreshUsbPrinters();

  panel.querySelector('#savePrinterBtn').addEventListener('click', async () => {
    try {
      await api.settings.update({
        printer_connection: panel.querySelector('input[name="printerConnection"]:checked').value,
        printer_ip: panel.querySelector('#printerIp').value.trim(),
        printer_port: panel.querySelector('#printerPort').value.trim() || '9100',
        printer_name: printerNameSelect.value,
        printer_type: panel.querySelector('#printerType').value,
      });
      await refresh();
      toast('Printer settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#testPrintBtn').addEventListener('click', async () => {
    if (!window.dineforge?.testPrint) {
      toast('Printing is only available in the desktop app', true);
      return;
    }
    const result = await window.dineforge.testPrint(getSession()?.token);
    toast(result.message || (result.success ? 'Test print sent' : 'Test print failed'), !result.success);
  });

  panel.querySelector('#openDrawerBtn').addEventListener('click', async () => {
    if (!window.dineforge?.openCashDrawer) {
      toast('Printing is only available in the desktop app', true);
      return;
    }
    const result = await window.dineforge.openCashDrawer(getSession()?.token);
    if (!result.success) {
      toast(result.message || 'Could not open cash drawer', true);
    }
  });

  panel.querySelector('#saveSettingsBtn').addEventListener('click', async () => {
    try {
      const chosen = CURRENCIES.find((c) => c.code === panel.querySelector('#setCurrency').value) || CURRENCIES[0];
      await api.settings.update({
        restaurant_name: panel.querySelector('#setName').value.trim(),
        currency: chosen.code,
        currency_symbol: chosen.symbol,
        restaurant_address: panel.querySelector('#setAddress').value.trim(),
        gstin: panel.querySelector('#setGstin').value.trim(),
        gst_scheme: panel.querySelector('#setGstScheme').value,
      });
      await refresh();
      toast('Settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#saveChargesBtn').addEventListener('click', async () => {
    try {
      await api.settings.update({
        delivery_fee_default_cents: Math.round(parseFloat(panel.querySelector('#setDeliveryFee').value || '0') * 100),
        packaging_fee_default_cents: Math.round(parseFloat(panel.querySelector('#setPackagingFee').value || '0') * 100),
      });
      await refresh();
      toast('Charges saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#saveUpiBtn').addEventListener('click', async () => {
    try {
      await api.settings.update({ upi_id: panel.querySelector('#setUpiId').value.trim() });
      await refresh();
      toast('UPI ID saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.querySelector('#saveTaxBtn').addEventListener('click', async () => {
    if (!defaultTax) return;
    try {
      await api.taxes.update(defaultTax.id, {
        name: panel.querySelector('#taxName').value.trim(),
        rate_percent: parseFloat(panel.querySelector('#taxRate').value || '0'),
        is_default: true,
      });
      await refresh();
      toast('Tax rate saved');
    } catch (err) {
      toast(err.message, true);
    }
  });
}
