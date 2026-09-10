import { api, money, toast, showModal, closeModal, clearSession } from './api.js';
import * as posView from './pos.js';
import * as kitchenView from './kitchen.js';
import * as adminView from './admin.js';
import * as wizard from './wizard.js';
import * as login from './login.js';

const views = { pos: posView, kitchen: kitchenView, admin: adminView };

// Which nav tabs (and therefore which view modules get initialized at all)
// each role can see. Admin is the superset role — full operational access,
// not just back-office.
const ROLE_TABS = {
  waiter: ['pos'],
  kitchen: ['kitchen'],
  admin: ['pos', 'kitchen', 'admin'],
};

let activeView = 'pos';
let currentShift = null;
let currentRole = null;

const shiftStatusEl = document.getElementById('shiftStatus');
const themeToggleEl = document.getElementById('themeToggle');
const logoutBtnEl = document.getElementById('logoutBtn');

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  themeToggleEl.textContent = theme === 'dark' ? 'Light' : 'Dark';
  try {
    localStorage.setItem('dineforge_theme', theme);
  } catch (e) {
    // Private browsing / storage disabled — theme just won't persist across launches.
  }
}

function initTheme() {
  applyTheme(currentTheme());
  themeToggleEl.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

async function boot() {
  window.dineforge?.onBackendRestarted?.(() => boot());
  window.addEventListener('dineforge:unauthorized', () => {
    toast('Session expired — please sign in again', true);
    window.location.reload();
  });

  initTheme();

  try {
    await wizard.runIfNeeded();
  } catch (err) {
    toast(`Setup wizard error: ${err.message}`, true);
  }

  currentRole = await login.ensureLoggedIn();
  const allowedTabs = ROLE_TABS[currentRole] || [];

  logoutBtnEl.hidden = false;
  logoutBtnEl.textContent = `Log Out (${currentRole[0].toUpperCase()}${currentRole.slice(1)})`;
  logoutBtnEl.addEventListener('click', onLogout);

  document.querySelectorAll('.tab').forEach((btn) => {
    const allowed = allowedTabs.includes(btn.dataset.view);
    btn.hidden = !allowed;
    if (allowed) {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    }
  });

  let settings;
  try {
    settings = await api.settings.get();
  } catch (err) {
    toast(`Could not reach backend: ${err.message}`, true);
    settings = {};
  }

  const ctx = { currencySymbol: settings.currency_symbol || '$', gstScheme: settings.gst_scheme || 'regular' };

  if (allowedTabs.includes('pos') || allowedTabs.includes('kitchen')) {
    await refreshShiftStatus();
    shiftStatusEl.addEventListener('click', onShiftStatusClick);
  } else {
    shiftStatusEl.hidden = true;
  }

  // Only initialize (and poll) the views this role can actually reach — an
  // uninitialized view's admin/kitchen-only API calls would otherwise 403
  // for a role that isn't allowed to make them.
  if (allowedTabs.includes('pos')) await posView.init(document.getElementById('view-pos'), ctx);
  if (allowedTabs.includes('kitchen')) await kitchenView.init(document.getElementById('view-kitchen'));
  if (allowedTabs.includes('admin')) await adminView.init(document.getElementById('view-admin'));

  switchView(allowedTabs[0] || 'pos');

  setInterval(() => {
    // Admin is a low-frequency back-office screen edited by one person at a
    // time; polling it would wipe out in-progress edits mid-keystroke by
    // re-rendering the whole form. It already refreshes after every save.
    if (activeView !== 'admin') {
      views[activeView]?.refresh?.();
    }
    if (allowedTabs.includes('pos') || allowedTabs.includes('kitchen')) {
      refreshShiftStatus();
    }
  }, 8000);
}

async function onLogout() {
  try {
    await api.auth.logout();
  } catch (err) {
    // Best-effort — clear the local session and reload regardless.
  }
  clearSession();
  window.location.reload();
}

function switchView(name) {
  activeView = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  views[name]?.refresh?.();
}

async function refreshShiftStatus() {
  try {
    const shift = await api.shifts.current();
    currentShift = shift && shift.status !== 'none' ? shift : null;
  } catch (err) {
    currentShift = null;
  }
  renderShiftStatus();
}

function renderShiftStatus() {
  if (currentShift) {
    shiftStatusEl.innerHTML = `<span class="shift-dot open"></span> Shift open — click to close`;
  } else {
    shiftStatusEl.innerHTML = `<span class="shift-dot"></span> No shift — click to open`;
  }
}

function onShiftStatusClick() {
  if (currentShift) {
    showModal(
      `
      <h2>Close Shift</h2>
      <div class="form-row">
        <label>Closing cash counted</label>
        <input id="closingCash" type="number" min="0" step="0.01" placeholder="0.00" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="shiftCancel">Cancel</button>
        <button class="btn primary" id="shiftConfirm">Close Shift</button>
      </div>
    `,
      (modal) => {
        modal.querySelector('#shiftCancel').addEventListener('click', closeModal);
        modal.querySelector('#shiftConfirm').addEventListener('click', async () => {
          const cents = Math.round(parseFloat(modal.querySelector('#closingCash').value || '0') * 100);
          try {
            const closed = await api.shifts.close(currentShift.id, { closing_cash_actual_cents: cents });
            const diff = closed.cash_difference_cents;
            closeModal();
            toast(diff === 0 ? 'Shift closed — cash matched exactly' : `Shift closed — difference: ${money(diff)}`);
            await refreshShiftStatus();
          } catch (err) {
            toast(err.message, true);
          }
        });
      }
    );
  } else {
    showModal(
      `
      <h2>Open Shift</h2>
      <div class="form-row">
        <label>Opening cash amount</label>
        <input id="openingCash" type="number" min="0" step="0.01" placeholder="0.00" value="0" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="shiftCancel">Cancel</button>
        <button class="btn primary" id="shiftConfirm">Open Shift</button>
      </div>
    `,
      (modal) => {
        modal.querySelector('#shiftCancel').addEventListener('click', closeModal);
        modal.querySelector('#shiftConfirm').addEventListener('click', async () => {
          const cents = Math.round(parseFloat(modal.querySelector('#openingCash').value || '0') * 100);
          try {
            await api.shifts.open({ opening_cash_cents: cents });
            closeModal();
            toast('Shift opened');
            await refreshShiftStatus();
          } catch (err) {
            toast(err.message, true);
          }
        });
      }
    );
  }
}

boot();
