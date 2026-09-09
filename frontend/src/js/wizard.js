import { api, toast, escapeHtml } from './api.js';

const TOTAL_STEPS = 4;

export async function runIfNeeded() {
  const settings = await api.settings.get();
  if (settings.setup_completed === '1') {
    return;
  }

  const overlay = document.getElementById('setupWizard');
  overlay.hidden = false;

  const state = {
    step: 0,
    restaurant_name: settings.restaurant_name || 'FoodNest',
    currency_symbol: settings.currency_symbol || '$',
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
  const steps = [renderRestaurantStep, renderTaxStep, renderOptionalStep, renderMenuStep];
  steps[state.step](overlay, state, finish, () => render(overlay, state, finish));
}

function wizardShell(body) {
  return `<div class="modal wizard-card">${body}</div>`;
}

function renderRestaurantStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(0)}
    <h1 class="wizard-title">Welcome to FoodNest POS</h1>
    <p class="wizard-subtitle">Let's get your restaurant set up. This only takes a minute.</p>
    <div class="form-row">
      <label>Restaurant name</label>
      <input id="wName" type="text" value="${escapeHtml(state.restaurant_name)}" />
    </div>
    <div class="form-row">
      <label>Currency symbol</label>
      <input id="wCurrency" type="text" value="${escapeHtml(state.currency_symbol)}" style="width:80px" />
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
    state.currency_symbol = overlay.querySelector('#wCurrency').value.trim() || '$';
    state.step = 1;
    rerender();
  });
}

function renderTaxStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(1)}
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
    state.step = 0;
    rerender();
  });
  overlay.querySelector('#wNext').addEventListener('click', () => {
    state.tax_name = overlay.querySelector('#wTaxName').value.trim() || 'Sales Tax';
    state.tax_rate = parseFloat(overlay.querySelector('#wTaxRate').value || '0');
    state.step = 2;
    rerender();
  });
}

function renderOptionalStep(overlay, state, finish, rerender) {
  const printerAvailable = !!window.foodnest?.testPrint;
  overlay.innerHTML = wizardShell(`
    ${stepDots(2)}
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
    state.step = 1;
    rerender();
  });
  overlay.querySelector('#wNext').addEventListener('click', () => {
    state.printer_ip = overlay.querySelector('#wPrinterIp').value.trim();
    state.admin_pin = overlay.querySelector('#wPin').value;
    if (state.admin_pin && state.admin_pin.length < 4) {
      toast('PIN must be at least 4 digits, or leave it blank', true);
      return;
    }
    state.step = 3;
    rerender();
  });
}

function renderMenuStep(overlay, state, finish, rerender) {
  overlay.innerHTML = wizardShell(`
    ${stepDots(3)}
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
    state.step = 2;
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
    ${stepDots(3)}
    <h1 class="wizard-title">Setting things up…</h1>
    <p class="wizard-subtitle">Just a moment.</p>
  `);

  try {
    await api.settings.update({
      restaurant_name: state.restaurant_name,
      currency_symbol: state.currency_symbol,
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
      await api.adminPin.set(state.admin_pin);
    }

    if (state.addSampleMenu) {
      await createSampleMenu();
    }

    toast('Setup complete — welcome to FoodNest POS!');
  } catch (err) {
    toast(`Setup error: ${err.message}`, true);
  } finally {
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
