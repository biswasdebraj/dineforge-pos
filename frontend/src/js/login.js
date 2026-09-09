import { api, toast, setSession, getSession } from './api.js';

const ROLE_LABELS = { waiter: 'Waiter', kitchen: 'Kitchen', admin: 'Admin' };

/**
 * Resolves once a valid role session exists — either an already-stored one
 * (sessionStorage, still unexpired) or a freshly logged-in one via the UI.
 * Returns the role string.
 */
export async function ensureLoggedIn() {
  const existing = getSession();
  if (existing) {
    return existing.role;
  }
  return showLoginScreen();
}

function showLoginScreen() {
  return new Promise((resolve) => {
    render(resolve);
  });
}

async function render(resolve) {
  const overlay = document.getElementById('roleLogin');
  overlay.hidden = false;

  let status = { waiter: false, kitchen: false, admin: false };
  try {
    status = await api.auth.status();
  } catch (err) {
    toast(`Could not reach backend: ${err.message}`, true);
  }

  overlay.innerHTML = `
    <div class="modal wizard-card">
      <h1 class="wizard-title">Sign In</h1>
      <p class="wizard-subtitle">Pick your role for this device.</p>
      <div class="role-picker">
        ${Object.entries(ROLE_LABELS)
          .map(
            ([role, label]) => `
          <button class="btn role-btn" data-role="${role}">
            ${label}
            ${status[role] ? '<span class="role-pin-hint">PIN required</span>' : ''}
          </button>`
          )
          .join('')}
      </div>
      <div id="rolePinRow" class="form-row" hidden>
        <label id="rolePinLabel">PIN</label>
        <input id="rolePinInput" type="password" inputmode="numeric" autocomplete="off" />
      </div>
      <div class="wizard-actions" id="loginActions" hidden>
        <div class="spacer"></div>
        <button class="btn primary" id="loginBtn">Sign In</button>
      </div>
    </div>
  `;

  let selectedRole = null;

  const pinRow = overlay.querySelector('#rolePinRow');
  const pinLabel = overlay.querySelector('#rolePinLabel');
  const pinInput = overlay.querySelector('#rolePinInput');
  const actions = overlay.querySelector('#loginActions');
  const loginBtn = overlay.querySelector('#loginBtn');

  function selectRole(role) {
    selectedRole = role;
    overlay.querySelectorAll('.role-btn').forEach((b) => b.classList.toggle('active', b.dataset.role === role));
    pinLabel.textContent = `${ROLE_LABELS[role]} PIN`;
    pinInput.value = '';
    if (status[role]) {
      pinRow.hidden = false;
      pinInput.focus();
    } else {
      pinRow.hidden = true;
    }
    actions.hidden = false;
  }

  overlay.querySelectorAll('.role-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectRole(btn.dataset.role));
  });

  async function attemptLogin() {
    if (!selectedRole) return;
    try {
      const result = await api.auth.login(selectedRole, pinInput.value);
      setSession(result.token, result.role);
      overlay.hidden = true;
      overlay.innerHTML = '';
      resolve(result.role);
    } catch (err) {
      toast(err.message, true);
      pinInput.value = '';
      pinInput.focus();
    }
  }

  loginBtn.addEventListener('click', attemptLogin);
  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
}
