# DineForge POS

A self-contained, offline-first point-of-sale system for single-location restaurants. DineForge ships as a native Windows desktop app — an Electron shell wrapping a PHP backend and a local SQLite database — with no cloud dependency, no monthly fee, and no internet connection required to take an order.

## Why

Most restaurant POS software is a subscription: a monthly fee, a cloud dependency, and your sales data living on someone else's server. DineForge is the opposite — one installer, one machine, your data stays on your network. Waiter and kitchen devices join over the same Wi-Fi and talk to that one machine directly.

## Features

- **Order management** — dine-in tables, order creation, item modifiers, customer name on ticket, void/refund handling
- **Kitchen Display System** — a dedicated Kitchen view that live-updates as orders are sent
- **Role-based access** — Waiter, Kitchen, and Admin roles, each with their own optional PIN and their own view of the app; every device signs in, including the primary terminal
- **LAN access with QR pairing** — the Admin panel shows a QR code that a phone or tablet on the same network can scan to open the app and sign in as Waiter or Kitchen, no app install required
- **Hardware integration** — network (TCP/IP) receipt printers, a cash drawer opened via the printer's pulse signal, and barcode scanner input for menu lookup
- **Shifts & cash reconciliation** — open/close a shift, track expected vs. counted cash
- **Automatic backups** — scheduled SQLite backups with one-click restore from Admin
- **Light/dark theme**, per-device
- **First-run setup wizard** — restaurant name, currency, tax rate, optional admin PIN, and an optional sample menu to explore the app immediately after install

## Tech stack

| Layer | Choice |
|---|---|
| Shell | [Electron](https://www.electronjs.org/) — bundles its own Chromium, no separate browser required |
| Backend | PHP 8.2 (built-in dev server, no framework), bundled portable runtime |
| Database | SQLite, WAL mode |
| Frontend | Vanilla JS (ES modules), no build step |
| Printing | [node-thermal-printer](https://www.npmjs.com/package/node-thermal-printer) |
| QR codes | [qrcode](https://www.npmjs.com/package/qrcode) |
| Packaging | [electron-builder](https://www.electron.build/) → NSIS installer for Windows |
| Testing | [PHPUnit](https://phpunit.de/) (backend) + [Playwright](https://playwright.dev/) (end-to-end, drives the real Electron app) |

## Project structure

```
backend/    PHP API — hand-rolled router, services, SQLite migrations, PHPUnit tests
frontend/   Static SPA served both to the local Electron window and to LAN devices
shell/      Electron main process — process orchestration, hardware IPC, packaging, E2E tests
```

## Getting started (development)

Requires Node.js and a PHP 8.2 runtime on your `PATH` (or run `shell/scripts/fetch-php.ps1` to download a portable one into `shell/resources/php/`).

```bash
cd shell
npm install
npm start
```

This launches PHP on a free local port and opens the Electron window pointed at it. On first run, the setup wizard walks you through restaurant name, tax rate, and an optional admin PIN.

### Running the tests

```bash
# Backend unit tests
cd backend
composer install
vendor/bin/phpunit

# End-to-end tests (drives the real Electron app)
cd shell
npm install
npx playwright test
```

### Building the Windows installer

```bash
cd shell
powershell -ExecutionPolicy Bypass -File scripts/fetch-php.ps1   # bundles a portable PHP runtime
npm run dist
```

Output lands in `dist/`.

## Status

Core roadmap (data model, API, hardware integration, security, packaging, first-run wizard) is complete. Role-based auth, LAN device access, and theming have landed since. KOT (kitchen ticket) printing, USB thermal printer support, and seamless auto-updates are in progress.

## License

[MIT](LICENSE)
