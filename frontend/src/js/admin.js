import { api, toast, escapeHtml } from './api.js';

let root = null;
let categories = [];
let items = [];
let tables = [];
let settings = {};
let taxes = [];

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
  [categories, items, tables, settings, taxes] = await Promise.all([
    api.categories.list(),
    api.items.list(),
    api.tables.list(),
    api.settings.get(),
    api.taxes.list(),
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
      <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Active</th><th></th></tr></thead>
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
    if (!name || !categoryId || price < 0) {
      toast('Enter a name, category, and price', true);
      return;
    }
    try {
      await api.items.create({ name, category_id: categoryId, price_cents: Math.round(price * 100) });
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
  `;

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
