import { api, toast, escapeHtml, setSession, clearSession, CURRENCIES } from './api.js';

const TOTAL_STEPS = 5;

export async function runIfNeeded() {
  const settings = await api.settings.get();
  if (settings.setup_completed === '1') {
    return;
  }

  const overlay = document.getElementById('setupWizard');
  overlay.hidden = false;

  const state = {
    step: 0,
    restaurant_name: settings.restaurant_name || '',
    currency: settings.currency || 'USD',
    currency_symbol: settings.currency_symbol || '$',
    restaurant_address: settings.restaurant_address || '',
    gstin: settings.gstin || '',
    gst_scheme: settings.gst_scheme || 'regular',
    tax_name: 'Sales Tax',
    tax_rate: 0,
    printer_ip: '',
    printer_port: '9100',
    admin_pin: '',
    addSampleMenu: false,
  };

  await new Promise((resolve) => {
    render(overlay, state, resolve);
  });

  overlay.hidden = true;
  overlay.innerHTML = '';
}

function stepDots(step) {
  let html = '<div class="wizard-steps">';
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const cls = i === step ? 'active' : i < step ? 'done' : '';
    html += `<div class="wizard-step-dot ${cls}"></div>`;
  }
  return html + '</div>';
}

function render(overlay, state, finish) {
  const steps = [renderRestaurantStep, renderBusinessStep, renderTaxStep, renderOptionalStep, renderMenuStep];
  steps[state.step](overlay, state, finish, () => render(overlay, state, finish));
}

function wizardShell(body) {
  return `<div class="modal wizard-card">${body}</div>`;
}

function renderRestaurantStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(0)}
    <h1 class="wizard-title">Welcome to DineForge POS</h1>
    <p class="wizard-subtitle">Let's get your restaurant set up. This only takes a minute.</p>
    <div class="form-row">
      <label>Restaurant name</label>
      <input id="wName" type="text" value="${escapeHtml(state.restaurant_name)}" />
    </div>
    <div class="form-row">
      <label>Currency</label>
      <select id="wCurrency">
        ${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === state.currency ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
    </div>
    <div class="wizard-actions">
      <div class="spacer"></div>
      <button class="btn primary" id="wNext">Next</button>
    </div>
  `);

  overlay.querySelector('#wNext').addEventListener('click', () => {
    const name = overlay.querySelector('#wName').value.trim();
    if (!name) {
      toast('Enter your restaurant name', true);
      return;
    }
    state.restaurant_name = name;
    const chosen = CURRENCIES.find((c) => c.code === overlay.querySelector('#wCurrency').value) || CURRENCIES[0];
    state.currency = chosen.code;
    state.currency_symbol = chosen.symbol;
    state.step = 1;
    rerender();
  });
}

function renderBusinessStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(1)}
    <h1 class="wizard-title">Business Details</h1>
    <p class="wizard-subtitle">All optional — used on printed receipts if filled in. Skip if you don't need them.</p>
    <div class="form-row">
      <label>Address</label>
      <input id="wAddress" type="text" value="${escapeHtml(state.restaurant_address)}" placeholder="Street, city, state, PIN" />
    </div>
    <div class="form-row">
      <label>GSTIN / Tax Registration No.</label>
      <input id="wGstin" type="text" value="${escapeHtml(state.gstin)}" placeholder="e.g. 22AAAAA0000A1Z5" />
    </div>
    <div class="form-row">
      <label>GST Scheme</label>
      <select id="wGstScheme">
        <option value="regular" ${state.gst_scheme !== 'composite' ? 'selected' : ''}>Regular (tax shown as CGST + SGST)</option>
        <option value="composite" ${state.gst_scheme === 'composite' ? 'selected' : ''}>Composite (tax included in price, not itemized)</option>
      </select>
    </div>
    <div class="wizard-actions">
      <button class="btn" id="wBack">Back</button>
      <div class="spacer"></div>
      <button class="btn primary" id="wNext">Next</button>
    </div>
  `);

  overlay.querySelector('#wBack').addEventListener('click', () => {
    state.step = 0;
    rerender();
  });
  overlay.querySelector('#wNext').addEventListener('click', () => {
    state.restaurant_address = overlay.querySelector('#wAddress').value.trim();
    state.gstin = overlay.querySelector('#wGstin').value.trim();
    state.gst_scheme = overlay.querySelector('#wGstScheme').value;
    state.step = 2;
    rerender();
  });
}

function renderTaxStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(2)}
    <h1 class="wizard-title">Sales Tax</h1>
    <p class="wizard-subtitle">Applied automatically to every order. You can change this later in Admin.</p>
    <div class="form-row">
      <label>Tax name</label>
      <input id="wTaxName" type="text" value="${escapeHtml(state.tax_name)}" />
    </div>
    <div class="form-row">
      <label>Rate (%)</label>
      <input id="wTaxRate" type="number" min="0" step="0.01" value="${state.tax_rate}" style="width:120px" />
    </div>
    <div class="wizard-actions">
      <button class="btn" id="wBack">Back</button>
      <div class="spacer"></div>
      <button class="btn primary" id="wNext">Next</button>
    </div>
  `);

  overlay.querySelector('#wBack').addEventListener('click', () => {
    state.step = 1;
    rerender();
  });
  overlay.querySelector('#wNext').addEventListener('click', () => {
    state.tax_name = overlay.querySelector('#wTaxName').value.trim() || 'Sales Tax';
    state.tax_rate = parseFloat(overlay.querySelector('#wTaxRate').value || '0');
    state.step = 3;
    rerender();
  });
}

function renderOptionalStep(overlay, state, finish, rerender) {
  const printerAvailable = !!window.dineforge?.testPrint;
  overlay.innerHTML = wizardShell(`
    ${stepDots(3)}
    <h1 class="wizard-title">Optional Setup</h1>
    <p class="wizard-subtitle">Both of these can be set up later in Admin &gt; Settings — skip for now if you'd rather.</p>
    <div class="form-row">
      <label>Receipt printer IP address ${printerAvailable ? '' : '(desktop app only)'}</label>
      <input id="wPrinterIp" type="text" value="${escapeHtml(state.printer_ip)}" placeholder="e.g. 192.168.1.50" ${printerAvailable ? '' : 'disabled'} />
    </div>
    <div class="form-row">
      <label>Admin PIN (protects menu/settings from customers or staff)</label>
      <input id="wPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Leave blank to skip" />
    </div>
    <div class="wizard-actions">
      <button class="btn" id="wBack">Back</button>
      <div class="spacer"></div>
      <button class="btn primary" id="wNext">Next</button>
    </div>
  `);

  overlay.querySelector('#wBack').addEventListener('click', () => {
    state.step = 2;
    rerender();
  });
  overlay.querySelector('#wNext').addEventListener('click', () => {
    state.printer_ip = overlay.querySelector('#wPrinterIp').value.trim();
    state.admin_pin = overlay.querySelector('#wPin').value;
    if (state.admin_pin && state.admin_pin.length < 4) {
      toast('PIN must be at least 4 digits, or leave it blank', true);
      return;
    }
    state.step = 4;
    rerender();
  });
}

function renderMenuStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(4)}
    <h1 class="wizard-title">Starting Menu</h1>
    <p class="wizard-subtitle">Add a few sample items to explore the app, or start with a blank menu and build your own in Admin.</p>
    <div class="wizard-actions">
      <button class="btn" id="wBack">Back</button>
      <div class="spacer"></div>
      <button class="btn" id="wSkipMenu">Start blank</button>
      <button class="btn primary" id="wSample">Add sample menu</button>
    </div>
  `);

  overlay.querySelector('#wBack').addEventListener('click', () => {
    state.step = 3;
    rerender();
  });
  overlay.querySelector('#wSkipMenu').addEventListener('click', () => {
    state.addSampleMenu = false;
    finishWizard(overlay, state, finish);
  });
  overlay.querySelector('#wSample').addEventListener('click', () => {
    state.addSampleMenu = true;
    finishWizard(overlay, state, finish);
  });
}

async function finishWizard(overlay, state, finish) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(4)}
    <h1 class="wizard-title">Setting things up…</h1>
    <p class="wizard-subtitle">Just a moment.</p>
  `);

  // Nearly everything below (settings, tax, menu, pins) is admin-guarded,
  // but nobody has logged in yet at this point in a fresh install — the
  // wizard runs before role login. No PIN exists yet either, so admin login
  // with a blank PIN is guaranteed to succeed (see AuthService::login).
  // Bootstrap a session just long enough to run setup, then clear it again
  // so the user still goes through proper role login afterward.
  try {
    const bootstrap = await api.auth.login('admin', '');
    setSession(bootstrap.token, 'admin');

    await api.settings.update({
      restaurant_name: state.restaurant_name,
      currency: state.currency,
      currency_symbol: state.currency_symbol,
      restaurant_address: state.restaurant_address,
      gstin: state.gstin,
      gst_scheme: state.gst_scheme,
      setup_completed: '1',
    });

    const taxes = await api.taxes.list();
    const defaultTax = taxes.find((t) => t.is_default) || taxes[0];
    if (defaultTax) {
      await api.taxes.update(defaultTax.id, {
        name: state.tax_name,
        rate_percent: state.tax_rate,
        is_default: true,
      });
    }

    if (state.printer_ip) {
      await api.settings.update({ printer_ip: state.printer_ip, printer_port: state.printer_port });
    }

    if (state.admin_pin) {
      await api.auth.setPin('admin', state.admin_pin);
    }

    if (state.addSampleMenu) {
      await createSampleMenu();
    }

    toast('Setup complete — welcome to DineForge POS!');
  } catch (err) {
    toast(`Setup error: ${err.message}`, true);
  } finally {
    clearSession();
    finish();
  }
}

async function createSampleMenu() {
  const burgers = await api.categories.create({ name: 'Burgers', sort_order: 1 });
  const drinks = await api.categories.create({ name: 'Drinks', sort_order: 2 });

  await Promise.all([
    api.items.create({ category_id: burgers.id, name: 'Classic Burger', price_cents: 950 }),
    api.items.create({ category_id: burgers.id, name: 'Cheeseburger', price_cents: 1050 }),
    api.items.create({ category_id: drinks.id, name: 'Soda', price_cents: 250 }),
    api.items.create({ category_id: drinks.id, name: 'Iced Tea', price_cents: 250 }),
  ]);
}
