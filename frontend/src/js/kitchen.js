import { api, toast, escapeHtml } from './api.js';

let root = null;

const NEXT_STATUS = {
  pending: 'preparing',
  sent: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

export async function init(container) {
  root = container;
  root.innerHTML = '<div class="kds-board" id="kdsBoard"></div>';
  await refresh();
}

export async function refresh() {
  if (!root) return;
  const board = root.querySelector('#kdsBoard');
  let orders;
  try {
    orders = await api.orders.list({ status: 'sent_to_kitchen', full: '1' });
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const withActiveItems = orders
    .map((o) => ({ ...o, items: o.items.filter((i) => i.status !== 'void' && i.status !== 'served') }))
    .filter((o) => o.items.length > 0);

  if (withActiveItems.length === 0) {
    board.innerHTML = '<div class="empty-hint">No active kitchen tickets.</div>';
    return;
  }

  board.innerHTML = withActiveItems
    .map(
      (o) => `
      <div class="kds-ticket" data-order-id="${o.id}">
        <div class="ticket-header"><span>#${o.order_number}</span><span>${o.order_type.replace(/_/g, ' ')}</span></div>
        ${o.items
          .map(
            (item) => `
          <div class="kds-item" data-item-id="${item.id}">
            <span>${item.quantity}× ${escapeHtml(item.item_name)}</span>
            <button class="status-pill ${item.status}" data-status="${item.status}">${item.status}</button>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('');

  board.querySelectorAll('.status-pill').forEach((btn) => {
    const ticket = btn.closest('.kds-ticket');
    const orderId = Number(ticket.dataset.orderId);
    const itemRow = btn.closest('.kds-item');
    const itemId = Number(itemRow.dataset.itemId);
    const current = btn.dataset.status;
    const next = NEXT_STATUS[current];
    if (!next) {
      btn.disabled = true;
      return;
    }
    btn.addEventListener('click', () => advance(orderId, itemId, next));
  });
}

async function advance(orderId, itemId, status) {
  try {
    await api.orders.setItemStatus(orderId, itemId, status);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}
