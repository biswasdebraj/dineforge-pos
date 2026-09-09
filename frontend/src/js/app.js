import { api, money, toast, showModal, closeModal } from './api.js';
import * as posView from './pos.js';
import * as kitchenView from './kitchen.js';
import * as adminView from './admin.js';
import * as wizard from './wizard.js';

const views = { pos: posView, kitchen: kitchenView, admin: adminView };
let activeView = 'pos';
let currentShift = null;
let adminUnlocked = false;

const shiftStatusEl = document.getElementById('shiftStatus');

async function boot() {
  window.dineforge?.onBackendRestarted?.(() => boot());

  try {
    await wizard.runIfNeeded();
  } catch (err) {
    toast(`Setup wizard error: ${err.message}`, true);
  }

  let settings;
  try {
    settings = await api.settings.get();
  } catch (err) {
    toast(`Could not reach backend: ${err.message}`, true);
    settings = {};
  }

  const ctx = { currencySymbol: settings.currency_symbol || '$' };

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => onTabClick(btn.dataset.view));
  });

  await refreshShiftStatus();
  shiftStatusEl.addEventListener('click', onShiftStatusClick);

  await posView.init(document.getElementById('view-pos'), ctx);
  await kitchenView.init(document.getElementById('view-kitchen'));
  await adminView.init(document.getElementById('view-admin'));

  setInterval(() => {
    // Admin is a low-frequency back-office screen edited by one person at a
    // time; polling it would wipe out in-progress edits mid-keystroke by
    // re-rendering the whole form. It already refreshes after every save.
    if (activeView !== 'admin') {
      views[activeView]?.refresh?.();
    }
    refreshShiftStatus();
  }, 8000);
}

async function onTabClick(name) {
  if (name === 'admin' && !adminUnlocked) {
    let status;
    try {
      status = await api.adminPin.status();
    } catch (err) {
      toast(err.message, true);
      return;
    }
    if (status.has_pin) {
      promptForAdminPin(() => switchView('admin'));
      return;
    }
  }
  switchView(name);
}

function promptForAdminPin(onSuccess) {
  showModal(
    `
    <h2>Admin Access</h2>
    <div class="form-row">
      <label>Enter PIN</label>
      <input id="adminPinInput" type="password" inputmode="numeric" autocomplete="off" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="pinCancel">Cancel</button>
      <button class="btn primary" id="pinUnlock">Unlock</button>
    </div>
  `,
    (modal) => {
      const input = modal.querySelector('#adminPinInput');
      input.focus();

      const attempt = async () => {
        try {
          const result = await api.adminPin.verify(input.value);
          if (result.valid) {
            adminUnlocked = true;
            closeModal();
            onSuccess();
          } else {
            toast('Incorrect PIN', true);
            input.value = '';
            input.focus();
          }
        } catch (err) {
          toast(err.message, true);
        }
      };

      modal.querySelector('#pinCancel').addEventListener('click', closeModal);
      modal.querySelector('#pinUnlock').addEventListener('click', attempt);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attempt();
      });
    }
  );
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
