async function ping() {
  const statusEl = document.getElementById('status');
  try {
    const res = await fetch(`${window.foodnest.apiBase}/api/ping`);
    const data = await res.json();
    statusEl.textContent = `Backend OK — ${data.restaurant_name}, migrations: ${data.migrations_applied}, time: ${data.time}`;
    statusEl.className = 'ok';
  } catch (err) {
    statusEl.textContent = `Backend unreachable: ${err.message}`;
    statusEl.className = 'error';
  }
}

window.addEventListener('DOMContentLoaded', ping);
