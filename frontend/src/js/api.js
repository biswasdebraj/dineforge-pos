async function getApiBase() {
  if (window.dineforge && window.dineforge.getApiBase) {
    return window.dineforge.getApiBase();
  }
  // ?api_base=... overrides for manual testing regardless of context.
  const override = new URLSearchParams(window.location.search).get('api_base');
  if (override) return override;

  // Not running inside Electron: either a LAN/mobile device that loaded this
  // page directly from the backend (same origin serves both the API and the
  // static frontend — see backend/src/support/static_frontend.php), or a
  // plain browser tab testing against a standalone php -S. Either way the
  // API lives at the origin the page itself was loaded from.
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }

  return 'http://127.0.0.1:8899';
}

export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee (₹)' },
  { code: 'AUD', symbol: '$', label: 'Australian Dollar ($)' },
  { code: 'CAD', symbol: '$', label: 'Canadian Dollar ($)' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen (¥)' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan (¥)' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham (د.إ)' },
  { code: 'SGD', symbol: '$', label: 'Singapore Dollar ($)' },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand (R)' },
  { code: 'NZD', symbol: '$', label: 'New Zealand Dollar ($)' },
];

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// Session lives in sessionStorage: cleared when the tab/app process ends,
// which matches "log in for your shift" semantics better than a persistent
// login. A device relogging in after a restart is expected, not a bug.
const SESSION_KEY = 'dineforge_session';

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || Date.now() >= session.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

export function setSession(token, role, hoursValid = 12) {
  const session = { token, role, expiresAt: Date.now() + hoursValid * 3600 * 1000 };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    // Storage disabled — session just won't survive a reload.
  }
  return session;
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // Ignore.
  }
}

async function apiFetch(path, options = {}) {
  const base = await getApiBase();
  const session = getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session) {
    headers['X-Session-Token'] = session.token;
  }

  const res = await fetch(`${base}${path}`, { headers, ...options });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearSession();
    window.dispatchEvent(new CustomEvent('dineforge:unauthorized'));
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
  auth: {
    status: () => apiFetch('/api/auth/status'),
    login: (role, pin) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ role, pin }) }),
    logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    setPin: (role, pin) => apiFetch('/api/auth/pins', { method: 'PUT', body: JSON.stringify({ role, pin }) }),
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
    updateCustomer: (id, customerName) =>
      apiFetch(`/api/orders/${id}/customer`, { method: 'PUT', body: JSON.stringify({ customer_name: customerName }) }),
    updateCharges: (id, body) => apiFetch(`/api/orders/${id}/charges`, { method: 'PUT', body: JSON.stringify(body) }),
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
