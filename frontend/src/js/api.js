async function getApiBase() {
  if (window.foodnest && window.foodnest.getApiBase) {
    return window.foodnest.getApiBase();
  }
  // Fallback for testing this page directly in a regular browser tab,
  // outside Electron: ?api_base=http://127.0.0.1:8899
  const override = new URLSearchParams(window.location.search).get('api_base');
  return override || 'http://127.0.0.1:8899';
}

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function apiFetch(path, options = {}) {
  const base = await getApiBase();
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    throw new Error((data && data.message) || `Request failed (${res.status})`);
  }

  return data;
}

export const api = {
  ping: () => apiFetch('/api/ping'),

  settings: {
    get: () => apiFetch('/api/settings'),
    update: (body) => apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  },
  adminPin: {
    status: () => apiFetch('/api/admin-pin/status'),
    verify: (pin) => apiFetch('/api/admin-pin/verify', { method: 'POST', body: JSON.stringify({ pin }) }),
    set: (pin) => apiFetch('/api/admin-pin', { method: 'PUT', body: JSON.stringify({ pin }) }),
  },
  taxes: {
    list: () => apiFetch('/api/taxes'),
    update: (id, body) => apiFetch(`/api/taxes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  backups: {
    list: () => apiFetch('/api/backups'),
    create: () => apiFetch('/api/backups', { method: 'POST' }),
  },
  categories: {
    list: () => apiFetch('/api/menu/categories'),
    create: (body) => apiFetch('/api/menu/categories', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/api/menu/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/api/menu/categories/${id}`, { method: 'DELETE' }),
  },
  items: {
    list: (params = {}) => apiFetch(`/api/menu/items${qs(params)}`),
    create: (body) => apiFetch('/api/menu/items', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/api/menu/items/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/api/menu/items/${id}`, { method: 'DELETE' }),
  },
  tables: {
    list: () => apiFetch('/api/tables'),
    create: (body) => apiFetch('/api/tables', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/api/tables/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  shifts: {
    current: () => apiFetch('/api/shifts/current'),
    open: (body) => apiFetch('/api/shifts/open', { method: 'POST', body: JSON.stringify(body) }),
    close: (id, body) => apiFetch(`/api/shifts/${id}/close`, { method: 'POST', body: JSON.stringify(body) }),
  },
  orders: {
    list: (params = {}) => apiFetch(`/api/orders${qs(params)}`),
    create: (body) => apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
    get: (id) => apiFetch(`/api/orders/${id}`),
    addItem: (id, body) => apiFetch(`/api/orders/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
    updateItem: (id, itemId, body) =>
      apiFetch(`/api/orders/${id}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(body) }),
    voidItem: (id, itemId) => apiFetch(`/api/orders/${id}/items/${itemId}`, { method: 'DELETE' }),
    setItemStatus: (id, itemId, status) =>
      apiFetch(`/api/orders/${id}/items/${itemId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    applyDiscount: (id, body) => apiFetch(`/api/orders/${id}/discounts`, { method: 'POST', body: JSON.stringify(body) }),
    removeDiscount: (id, discountId) => apiFetch(`/api/orders/${id}/discounts/${discountId}`, { method: 'DELETE' }),
    send: (id) => apiFetch(`/api/orders/${id}/send`, { method: 'POST' }),
    void: (id) => apiFetch(`/api/orders/${id}/void`, { method: 'POST' }),
    pay: (id, body) => apiFetch(`/api/orders/${id}/payments`, { method: 'POST', body: JSON.stringify(body) }),
  },
};

export function money(cents, symbol = '$') {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

export function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 4000 : 2200);
}

export function showModal(html, wire) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'activeModal';
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  wire(backdrop.querySelector('.modal'));
}

export function closeModal() {
  document.getElementById('activeModal')?.remove();
}
