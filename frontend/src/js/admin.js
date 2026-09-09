import { api, toast, escapeHtml } from './api.js';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      <button class="admin-tab" data-tab="settings">Settings</button>
    </div>
    <div class="admin-panel active" id="admin-menu"></div>
    <div class="admin-panel" id="admin-tables"></div>
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
  renderSettings();
}

function renderMenu() {
  const panel = root.querySelector('#admin-menu');
  panel.innerHTML = `
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
      <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>SKU / Barcode</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${items
          .map(
            (i) => `
          <tr data-id="${i.id}">
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

function renderSettings() {
  const panel = root.querySelector('#admin-settings');
  const defaultTax = taxes.find((t) => t.is_default) || taxes[0];

  panel.innerHTML = `
    <div class="section-title">Restaurant</div>
    <div class="form-row">
      <input id="setName" type="text" value="${escapeHtml(settings.restaurant_name || '')}" placeholder="Restaurant name" />
      <input id="setCurrencySymbol" type="text" value="${escapeHtml(settings.currency_symbol || '$')}" placeholder="Currency symbol" style="width:80px" />
      <button class="btn primary" id="saveSettingsBtn">Save</button>
    </div>

    <div class="section-title">Tax</div>
    <div class="form-row">
      <input id="taxName" type="text" value="${escapeHtml(defaultTax?.name || '')}" placeholder="Tax name" />
      <input id="taxRate" type="number" min="0" step="0.01" value="${defaultTax?.rate_percent ?? 0}" placeholder="Rate %" style="width:100px" />
      <button class="btn primary" id="saveTaxBtn">Save Tax</button>
    </div>
    <div class="empty-hint">This rate applies automatically to every order's subtotal after discounts.</div>

    <div class="section-title">Receipt Printer</div>
    <div class="form-row">
      <input id="printerIp" type="text" value="${escapeHtml(settings.printer_ip || '')}" placeholder="Printer IP address" style="width:160px" />
      <input id="printerPort" type="text" value="${escapeHtml(settings.printer_port || '9100')}" placeholder="Port" style="width:80px" />
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
    <div class="empty-hint">Network (Ethernet/Wi-Fi) ESC/POS printers only, e.g. 192.168.1.50. USB/serial printers aren't supported yet. Only available in the desktop app, not a browser tab.</div>

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
  `;

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

  panel.querySelector('#savePrinterBtn').addEventListener('click', async () => {
    try {
      await api.settings.update({
        printer_ip: panel.querySelector('#printerIp').value.trim(),
        printer_port: panel.querySelector('#printerPort').value.trim() || '9100',
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
    const result = await window.dineforge.testPrint();
    toast(result.message || (result.success ? 'Test print sent' : 'Test print failed'), !result.success);
  });

  panel.querySelector('#openDrawerBtn').addEventListener('click', async () => {
    if (!window.dineforge?.openCashDrawer) {
      toast('Printing is only available in the desktop app', true);
      return;
    }
    const result = await window.dineforge.openCashDrawer();
    if (!result.success) {
      toast(result.message || 'Could not open cash drawer', true);
    }
  });

  panel.querySelector('#saveSettingsBtn').addEventListener('click', async () => {
    try {
      await api.settings.update({
        restaurant_name: panel.querySelector('#setName').value.trim(),
        currency_symbol: panel.querySelector('#setCurrencySymbol').value.trim(),
      });
      toast('Settings saved');
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
