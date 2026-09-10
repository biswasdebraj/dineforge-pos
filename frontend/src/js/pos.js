import { api, money, toast, escapeHtml, showModal, closeModal, apiUrl } from './api.js';

let categories = [];
let items = [];
let tables = [];
let activeCategoryId = null;
let currentOrder = null;
let currencySymbol = '$';
let gstScheme = 'regular';
let apiBase = '';
let els = {};

export async function init(root, ctx) {
  currencySymbol = ctx.currencySymbol;
  gstScheme = ctx.gstScheme;
  apiBase = await apiUrl('');

  root.innerHTML = `
    <div class="pos-layout">
      <div class="menu-panel">
        <div class="category-tabs" id="categoryTabs"></div>
        <div class="item-grid" id="itemGrid"></div>
      </div>
      <div class="cart-panel">
        <div class="order-header">
          <select id="orderPicker"><option value="">— Select an open order —</option></select>
        </div>
        <div class="order-meta">
          <select id="orderTypeSelect">
            <option value="dine_in">Dine-in</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
          </select>
          <select id="tableSelect"><option value="">No table</option></select>
        </div>
        <div class="order-meta">
          <input id="customerNameInput" type="text" placeholder="Customer name (optional)" style="flex:1" />
          <button class="btn" id="newOrderBtn">New Order</button>
        </div>
        <div id="orderLabel" class="empty-hint">No order selected</div>
        <div id="orderCustomerRow" class="empty-hint" hidden>
          <span id="orderCustomerText"></span>
          <button class="inline-btn" id="editCustomerBtn">Edit</button>
        </div>
        <div class="cart-items" id="cartItems"></div>
        <div class="cart-totals" id="cartTotals"></div>
        <div class="cart-actions">
          <button class="btn" id="discountBtn" disabled>Apply Discount</button>
          <button class="btn" id="sendBtn" disabled>Send to Kitchen</button>
          <button class="btn" id="printKotBtn" disabled>Print KOT</button>
          <button class="btn primary" id="payBtn" disabled>Pay</button>
          <button class="btn danger" id="voidOrderBtn" disabled>Void Order</button>
        </div>
      </div>
    </div>
  `;

  els = {
    categoryTabs: root.querySelector('#categoryTabs'),
    itemGrid: root.querySelector('#itemGrid'),
    orderPicker: root.querySelector('#orderPicker'),
    orderTypeSelect: root.querySelector('#orderTypeSelect'),
    tableSelect: root.querySelector('#tableSelect'),
    newOrderBtn: root.querySelector('#newOrderBtn'),
    customerNameInput: root.querySelector('#customerNameInput'),
    orderLabel: root.querySelector('#orderLabel'),
    orderCustomerRow: root.querySelector('#orderCustomerRow'),
    orderCustomerText: root.querySelector('#orderCustomerText'),
    editCustomerBtn: root.querySelector('#editCustomerBtn'),
    cartItems: root.querySelector('#cartItems'),
    cartTotals: root.querySelector('#cartTotals'),
    discountBtn: root.querySelector('#discountBtn'),
    sendBtn: root.querySelector('#sendBtn'),
    printKotBtn: root.querySelector('#printKotBtn'),
    payBtn: root.querySelector('#payBtn'),
    voidOrderBtn: root.querySelector('#voidOrderBtn'),
  };

  els.newOrderBtn.addEventListener('click', onNewOrder);
  els.editCustomerBtn.addEventListener('click', onEditCustomerName);
  els.orderPicker.addEventListener('change', onPickOrder);
  els.sendBtn.addEventListener('click', onSendToKitchen);
  els.printKotBtn.addEventListener('click', onPrintKOT);
  els.voidOrderBtn.addEventListener('click', onVoidOrder);
  els.discountBtn.addEventListener('click', onOpenDiscountModal);
  els.payBtn.addEventListener('click', onOpenPaymentModal);

  await loadMenu();
  await loadTables();
  await refresh();

  initBarcodeScanner();
}

// Barcode scanners act as a keyboard typing very fast, ending with Enter.
// We only intercept when focus isn't in a text field, so manually typing a
// SKU into an admin form (or scanning into it) still works normally.
function initBarcodeScanner() {
  let buffer = '';
  let resetTimer = null;

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isEditable = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    if (isEditable) return;

    if (e.key === 'Enter') {
      const code = buffer;
      buffer = '';
      clearTimeout(resetTimer);
      if (code.length >= 3) {
        onBarcodeScanned(code);
      }
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        buffer = '';
      }, 500);
    }
  });
}

async function onBarcodeScanned(code) {
  if (!currentOrder) {
    toast('Start or select an order first', true);
    return;
  }
  try {
    const matches = await api.items.list({ sku: code, active_only: '1' });
    if (matches.length === 0) {
      toast(`No item found for barcode "${code}"`, true);
      return;
    }
    await onAddItem(matches[0].id);
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadMenu() {
  categories = await api.categories.list();
  items = await api.items.list({ active_only: '1' });
  activeCategoryId = categories[0]?.id ?? null;
  renderCategoryTabs();
  renderItemGrid();
}

async function loadTables() {
  tables = await api.tables.list();
  els.tableSelect.innerHTML =
    '<option value="">No table</option>' +
    tables.map((t) => `<option value="${t.id}">${escapeHtml(t.label)} (${t.seats} seats)</option>`).join('');
}

export async function refresh() {
  const openOrders = await api.orders.list({ status: 'open' });
  const sentOrders = await api.orders.list({ status: 'sent_to_kitchen' });
  const active = [...openOrders, ...sentOrders].sort((a, b) => b.id - a.id);

  const previousSelection = currentOrder?.id ?? '';
  els.orderPicker.innerHTML =
    '<option value="">— Select an open order —</option>' +
    active
      .map((o) => {
        const customer = o.customer_name ? ` · ${escapeHtml(o.customer_name)}` : '';
        return `<option value="${o.id}">#${o.order_number} · ${describeOrder(o)}${customer}</option>`;
      })
      .join('');

  if (previousSelection && active.some((o) => o.id === previousSelection)) {
    els.orderPicker.value = String(previousSelection);
    currentOrder = await api.orders.get(previousSelection);
  } else {
    currentOrder = null;
    els.orderPicker.value = '';
  }

  renderCart();
}

function describeOrder(o) {
  const table = tables.find((t) => t.id === o.table_id);
  if (o.order_type === 'dine_in' && table) return `Dine-in · ${table.label}`;
  if (o.order_type === 'dine_in') return 'Dine-in';
  return o.order_type === 'takeaway' ? 'Takeaway' : 'Delivery';
}

function renderCategoryTabs() {
  els.categoryTabs.innerHTML = categories
    .map(
      (c) =>
        `<button class="category-tab${c.id === activeCategoryId ? ' active' : ''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`
    )
    .join('');
  els.categoryTabs.querySelectorAll('.category-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategoryId = Number(btn.dataset.id);
      renderCategoryTabs();
      renderItemGrid();
    });
  });
}

function renderItemGrid() {
  const visible = items.filter((i) => i.category_id === activeCategoryId);
  if (visible.length === 0) {
    els.itemGrid.innerHTML = '<div class="empty-hint">No items in this category yet.</div>';
    return;
  }
  els.itemGrid.innerHTML = visible
    .map(
      (i) => `
      <button class="item-card" data-id="${i.id}">
        ${i.image_path ? `<img class="item-card-image" src="${apiBase}/api/menu/images/${i.image_path}" alt="" />` : ''}
        <div class="name">${escapeHtml(i.name)}</div>
        <div class="price">${money(i.price_cents, currencySymbol)}</div>
      </button>`
    )
    .join('');
  els.itemGrid.querySelectorAll('.item-card').forEach((btn) => {
    btn.addEventListener('click', () => onAddItem(Number(btn.dataset.id)));
  });
}

async function onAddItem(menuItemId) {
  if (!currentOrder) {
    toast('Start or select an order first', true);
    return;
  }
  try {
    const existing = currentOrder.items.find(
      (i) => i.menu_item_id === menuItemId && i.status !== 'void' && i.modifiers.length === 0
    );
    currentOrder = existing
      ? await api.orders.updateItem(currentOrder.id, existing.id, { quantity: existing.quantity + 1 })
      : await api.orders.addItem(currentOrder.id, { menu_item_id: menuItemId, quantity: 1 });
    renderCart();
  } catch (err) {
    toast(err.message, true);
  }
}

async function onNewOrder() {
  try {
    const orderType = els.orderTypeSelect.value;
    const tableId = els.tableSelect.value || null;
    const customerName = els.customerNameInput.value.trim() || null;
    currentOrder = await api.orders.create({ order_type: orderType, table_id: tableId, customer_name: customerName });
    els.customerNameInput.value = '';
    await refresh();
    els.orderPicker.value = String(currentOrder.id);
  } catch (err) {
    toast(err.message, true);
  }
}

function onEditCustomerName() {
  if (!currentOrder) return;
  showModal(
    `
    <h2>Customer Name</h2>
    <div class="form-row">
      <label>Name</label>
      <input id="custNameInput" type="text" value="${escapeHtml(currentOrder.customer_name || '')}" placeholder="Optional" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="custCancel">Cancel</button>
      <button class="btn primary" id="custSave">Save</button>
    </div>
  `,
    (modal) => {
      const input = modal.querySelector('#custNameInput');
      input.focus();
      modal.querySelector('#custCancel').addEventListener('click', closeModal);
      modal.querySelector('#custSave').addEventListener('click', async () => {
        try {
          currentOrder = await api.orders.updateCustomer(currentOrder.id, input.value.trim());
          closeModal();
          renderCart();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  );
}

function onEditCharges() {
  if (!currentOrder) return;
  showModal(
    `
    <h2>Delivery &amp; Packaging</h2>
    <div class="form-row">
      <label>Delivery Fee</label>
      <input id="deliveryFeeInput" type="number" min="0" step="0.01" value="${(currentOrder.delivery_fee_cents / 100).toFixed(2)}" />
    </div>
    <div class="form-row">
      <label>Packaging Fee</label>
      <input id="packagingFeeInput" type="number" min="0" step="0.01" value="${(currentOrder.packaging_fee_cents / 100).toFixed(2)}" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="chargesCancel">Cancel</button>
      <button class="btn primary" id="chargesSave">Save</button>
    </div>
  `,
    (modal) => {
      modal.querySelector('#chargesCancel').addEventListener('click', closeModal);
      modal.querySelector('#chargesSave').addEventListener('click', async () => {
        try {
          const deliveryFeeCents = Math.round(parseFloat(modal.querySelector('#deliveryFeeInput').value || '0') * 100);
          const packagingFeeCents = Math.round(parseFloat(modal.querySelector('#packagingFeeInput').value || '0') * 100);
          currentOrder = await api.orders.updateCharges(currentOrder.id, {
            delivery_fee_cents: deliveryFeeCents,
            packaging_fee_cents: packagingFeeCents,
          });
          closeModal();
          renderCart();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  );
}

async function onPickOrder() {
  const id = els.orderPicker.value;
  if (!id) {
    currentOrder = null;
    renderCart();
    return;
  }
  try {
    currentOrder = await api.orders.get(Number(id));
    renderCart();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderCart() {
  if (!currentOrder) {
    els.orderLabel.textContent = 'No order selected';
    els.orderLabel.classList.add('empty-hint');
    els.orderCustomerRow.hidden = true;
    els.cartItems.innerHTML = '';
    els.cartTotals.innerHTML = '';
    setActionsEnabled(false);
    return;
  }

  els.orderLabel.classList.remove('empty-hint');
  els.orderLabel.textContent = `Order #${currentOrder.order_number} · ${describeOrder(currentOrder)} · ${currentOrder.status.replace(/_/g, ' ')}`;

  const editable = ['open', 'sent_to_kitchen'].includes(currentOrder.status);
  els.orderCustomerRow.hidden = false;
  els.orderCustomerText.textContent = currentOrder.customer_name
    ? `Customer: ${currentOrder.customer_name}`
    : 'No customer name set';
  els.editCustomerBtn.hidden = !editable;

  if (currentOrder.items.length === 0) {
    els.cartItems.innerHTML = '<div class="empty-hint">No items yet — tap a menu item to add it.</div>';
  } else {
    els.cartItems.innerHTML = currentOrder.items
      .map((item) => {
        const isVoid = item.status === 'void';
        const mods = item.modifiers.length
          ? `<div class="mods">${item.modifiers.map((m) => escapeHtml(m.modifier_name)).join(', ')}</div>`
          : '';
        return `
        <div class="cart-item${isVoid ? ' is-void' : ''}" data-item-id="${item.id}">
          <div class="row">
            <span class="name">${escapeHtml(item.item_name)}</span>
            <span>${money(item.unit_price_cents * item.quantity, currencySymbol)}</span>
          </div>
          ${mods}
          <div class="row">
            <div class="qty-controls">
              <button data-action="dec" ${isVoid ? 'disabled' : ''}>−</button>
              <span>${item.quantity}</span>
              <button data-action="inc" ${isVoid ? 'disabled' : ''}>+</button>
            </div>
            ${isVoid ? '<span class="mods">voided</span>' : '<button class="void-btn" data-action="void">Void</button>'}
          </div>
        </div>`;
      })
      .join('');

    els.cartItems.querySelectorAll('.cart-item').forEach((row) => {
      const itemId = Number(row.dataset.itemId);
      const item = currentOrder.items.find((i) => i.id === itemId);
      row.querySelector('[data-action="inc"]')?.addEventListener('click', () => onChangeQty(item, item.quantity + 1));
      row.querySelector('[data-action="dec"]')?.addEventListener('click', () => onChangeQty(item, item.quantity - 1));
      row.querySelector('[data-action="void"]')?.addEventListener('click', () => onVoidItem(item));
    });
  }

  const discountLine = currentOrder.discount_total_cents
    ? `<div class="row"><span>Discount</span><span>-${money(currentOrder.discount_total_cents, currencySymbol)}</span></div>`
    : '';

  const chargesEditable = editable && currentOrder.order_type !== 'dine_in';
  const chargesLine = currentOrder.order_type === 'dine_in'
    ? ''
    : `<div class="row">
        <span>Delivery Fee${chargesEditable ? ' <a href="#" id="editChargesLink">edit</a>' : ''}</span>
        <span>${money(currentOrder.delivery_fee_cents, currencySymbol)}</span>
      </div>
      <div class="row"><span>Packaging Fee</span><span>${money(currentOrder.packaging_fee_cents, currencySymbol)}</span></div>`;

  let taxLines;
  if (gstScheme === 'composite') {
    taxLines = '<div class="empty-hint">Composition scheme — tax included in price, not itemized.</div>';
  } else {
    const cgst = Math.round(currentOrder.tax_total_cents / 2);
    const sgst = currentOrder.tax_total_cents - cgst;
    taxLines = `
      <div class="row"><span>CGST</span><span>${money(cgst, currencySymbol)}</span></div>
      <div class="row"><span>SGST</span><span>${money(sgst, currencySymbol)}</span></div>
    `;
  }

  els.cartTotals.innerHTML = `
    <div class="row"><span>Subtotal</span><span>${money(currentOrder.subtotal_cents, currencySymbol)}</span></div>
    ${discountLine}
    ${chargesLine}
    ${taxLines}
    <div class="row total"><span>Total</span><span>${money(currentOrder.total_cents, currencySymbol)}</span></div>
  `;

  if (chargesEditable) {
    els.cartTotals.querySelector('#editChargesLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      onEditCharges();
    });
  }

  setActionsEnabled(editable, currentOrder);
}

function setActionsEnabled(enabled, order = null) {
  els.discountBtn.disabled = !enabled;
  els.voidOrderBtn.disabled = !enabled;
  els.sendBtn.disabled = !enabled || !order || order.items.every((i) => i.status !== 'pending');
  els.printKotBtn.disabled = !enabled || !order || order.items.every((i) => i.status === 'pending' || i.status === 'void');
  els.payBtn.disabled = !enabled || !order || order.total_cents <= 0;
}

async function onChangeQty(item, newQty) {
  if (!currentOrder) return;
  try {
    if (newQty < 1) {
      currentOrder = await api.orders.voidItem(currentOrder.id, item.id);
    } else {
      currentOrder = await api.orders.updateItem(currentOrder.id, item.id, { quantity: newQty });
    }
    renderCart();
  } catch (err) {
    toast(err.message, true);
  }
}

async function onVoidItem(item) {
  if (!currentOrder || !window.confirm(`Void ${item.item_name}?`)) return;
  try {
    currentOrder = await api.orders.voidItem(currentOrder.id, item.id);
    renderCart();
  } catch (err) {
    toast(err.message, true);
  }
}

async function onSendToKitchen() {
  if (!currentOrder) return;
  try {
    const newlySentIds = currentOrder.items.filter((i) => i.status === 'pending').map((i) => i.id);
    currentOrder = await api.orders.send(currentOrder.id);
    toast('Sent to kitchen');
    renderCart();

    if (newlySentIds.length && window.dineforge?.printKOT) {
      window.dineforge.printKOT(currentOrder.id, newlySentIds).then((r) => {
        if (!r.success) toast(r.message || 'KOT did not print', true);
      });
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function onPrintKOT() {
  if (!currentOrder) return;
  if (!window.dineforge?.printKOT) {
    toast('Printing is only available on the desktop app, not this device', true);
    return;
  }
  const itemIds = currentOrder.items.filter((i) => i.status !== 'pending' && i.status !== 'void').map((i) => i.id);
  if (!itemIds.length) return;
  const r = await window.dineforge.printKOT(currentOrder.id, itemIds);
  if (!r.success) toast(r.message || 'KOT did not print', true);
  else toast('KOT sent to printer');
}

async function onVoidOrder() {
  if (!currentOrder || !window.confirm(`Void the entire order #${currentOrder.order_number}?`)) return;
  try {
    await api.orders.void(currentOrder.id);
    toast('Order voided');
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

function onOpenDiscountModal() {
  if (!currentOrder) return;
  showModal(`
    <h2>Apply Discount</h2>
    <div class="form-row">
      <label>Type</label>
      <select id="discType">
        <option value="percent">Percent (%)</option>
        <option value="fixed">Fixed amount</option>
      </select>
    </div>
    <div class="form-row">
      <label>Value</label>
      <input id="discValue" type="number" min="0" step="0.01" placeholder="e.g. 10" />
    </div>
    <div class="form-row">
      <label>Label (optional)</label>
      <input id="discLabel" type="text" placeholder="e.g. Happy Hour" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="discCancel">Cancel</button>
      <button class="btn primary" id="discSave">Apply</button>
    </div>
  `, (modal) => {
    modal.querySelector('#discCancel').addEventListener('click', closeModal);
    modal.querySelector('#discSave').addEventListener('click', async () => {
      const type = modal.querySelector('#discType').value;
      const value = parseFloat(modal.querySelector('#discValue').value);
      const label = modal.querySelector('#discLabel').value.trim() || undefined;
      if (!value || value <= 0) {
        toast('Enter a discount value', true);
        return;
      }
      try {
        currentOrder = await api.orders.applyDiscount(currentOrder.id, { type, value, label });
        closeModal();
        renderCart();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function onOpenPaymentModal() {
  if (!currentOrder) return;
  const totalDue = currentOrder.total_cents;
  let method = 'cash';

  showModal(`
    <h2>Pay Order #${currentOrder.order_number}</h2>
    <div class="method-picker">
      <button class="btn active" data-method="cash">Cash</button>
      <button class="btn" data-method="card">Card</button>
      <button class="btn" data-method="other">Other</button>
    </div>
    <div class="form-row"><label>Amount Due</label><input id="payAmount" type="text" value="${(totalDue / 100).toFixed(2)}" disabled /></div>
    <div class="form-row" id="tenderedRow"><label>Tendered</label><input id="payTendered" type="number" min="0" step="0.01" value="${(totalDue / 100).toFixed(2)}" /></div>
    <div class="form-row"><label>Change Due</label><input id="payChange" type="text" value="${money(0, currencySymbol)}" disabled /></div>
    <div class="form-row" style="flex-direction:row;align-items:center;gap:0.5rem;">
      <input id="payPrintReceipt" type="checkbox" checked />
      <label style="margin:0;">Print receipt</label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="payCancel">Cancel</button>
      <button class="btn primary" id="payConfirm">Confirm Payment</button>
    </div>
  `, (modal) => {
    const tenderedInput = modal.querySelector('#payTendered');
    const changeOut = modal.querySelector('#payChange');
    const tenderedRow = modal.querySelector('#tenderedRow');

    function updateChange() {
      const tendered = Math.round(parseFloat(tenderedInput.value || '0') * 100);
      const change = Math.max(0, tendered - totalDue);
      changeOut.value = money(change, currencySymbol);
    }
    tenderedInput.addEventListener('input', updateChange);
    updateChange();

    modal.querySelectorAll('.method-picker button').forEach((btn) => {
      btn.addEventListener('click', () => {
        method = btn.dataset.method;
        modal.querySelectorAll('.method-picker button').forEach((b) => b.classList.toggle('active', b === btn));
        tenderedRow.style.display = method === 'cash' ? 'flex' : 'none';
      });
    });

    modal.querySelector('#payCancel').addEventListener('click', closeModal);
    modal.querySelector('#payConfirm').addEventListener('click', async () => {
      const tenderedCents =
        method === 'cash' ? Math.round(parseFloat(tenderedInput.value || '0') * 100) : totalDue;
      const shouldPrint = modal.querySelector('#payPrintReceipt').checked;
      const paidOrderId = currentOrder.id;
      try {
        await api.orders.pay(paidOrderId, {
          method,
          amount_cents: totalDue,
          tendered_cents: tenderedCents,
        });
        toast('Payment recorded');
        closeModal();
        currentOrder = null;
        await refresh();

        if (method === 'cash' && window.dineforge?.openCashDrawer) {
          window.dineforge.openCashDrawer().then((r) => {
            if (!r.success) toast(r.message || 'Could not open cash drawer', true);
          });
        }
        if (shouldPrint && window.dineforge?.printReceipt) {
          window.dineforge.printReceipt(paidOrderId).then((r) => {
            if (!r.success) toast(r.message || 'Receipt did not print', true);
          });
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

