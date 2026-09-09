<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/support/response.php';
require_once __DIR__ . '/../src/support/router.php';
require_once __DIR__ . '/../src/support/audit.php';
require_once __DIR__ . '/../src/support/guard.php';
require_once __DIR__ . '/../src/support/static_frontend.php';
require_once __DIR__ . '/../src/db/connection.php';

$requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!str_starts_with($requestUri, '/api/')) {
    serve_static_frontend($requestUri);
    exit;
}
require_once __DIR__ . '/../src/services/MenuService.php';
require_once __DIR__ . '/../src/services/ShiftService.php';
require_once __DIR__ . '/../src/services/OrderService.php';
require_once __DIR__ . '/../src/services/SettingsService.php';
require_once __DIR__ . '/../src/services/BackupService.php';
require_once __DIR__ . '/../src/services/AuthService.php';

$pdo = get_db_connection();
$menuService = new MenuService($pdo);
$shiftService = new ShiftService($pdo);
$orderService = new OrderService($pdo);
$settingsService = new SettingsService($pdo);
$backupService = new BackupService($pdo, get_data_dir() . '/backups');
$authService = new AuthService($pdo);

$router = new Router();

$router->get('/api/ping', function () use ($pdo) {
    $restaurantName = $pdo->query("SELECT value FROM settings WHERE key = 'restaurant_name'")->fetchColumn();
    $migrationCount = (int) $pdo->query('SELECT COUNT(*) FROM _migrations')->fetchColumn();

    json_response([
        'status' => 'ok',
        'sqlite' => 'connected',
        'restaurant_name' => $restaurantName,
        'migrations_applied' => $migrationCount,
        'time' => date(DATE_ATOM),
    ]);
});

// Auth — role login (Waiter/Kitchen/Admin), required by every device
// (local terminal and LAN devices alike) before touching anything else.
$router->get('/api/auth/status', function () use ($authService) {
    json_response($authService->status());
});
$router->post('/api/auth/login', function () use ($authService) {
    $input = json_body();
    $role = (string) ($input['role'] ?? '');
    $pin = (string) ($input['pin'] ?? '');
    try {
        $token = $authService->login($role, $pin);
    } catch (InvalidArgumentException $e) {
        json_error($e->getMessage(), 422);
    }
    if ($token === null) {
        json_error('Incorrect PIN', 401);
    }
    json_response(['token' => $token, 'role' => $role]);
});
$router->post('/api/auth/logout', function () use ($authService) {
    $token = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? null;
    if ($token !== null) {
        $authService->logout($token);
    }
    json_response(['status' => 'ok']);
});
$router->put('/api/auth/pins', guarded($authService, ['admin'], function () use ($authService) {
    $input = json_body();
    $role = (string) ($input['role'] ?? '');
    $pin = isset($input['pin']) && $input['pin'] !== '' ? (string) $input['pin'] : null;
    $authService->setPin($role, $pin);
    json_response($authService->status());
}));

// Menu categories — reads are public (menu/prices aren't sensitive and are
// needed to render before login), writes are admin-only.
$router->get('/api/menu/categories', function () use ($menuService) {
    json_response($menuService->listCategories());
});
$router->post('/api/menu/categories', guarded($authService, ['admin'], function () use ($menuService) {
    json_response($menuService->createCategory(json_body()), 201);
}));
$router->put('/api/menu/categories/{id}', guarded($authService, ['admin'], function (array $p) use ($menuService) {
    json_response($menuService->updateCategory((int) $p['id'], json_body()));
}));
$router->delete('/api/menu/categories/{id}', guarded($authService, ['admin'], function (array $p) use ($menuService) {
    $menuService->deleteCategory((int) $p['id']);
    json_response(['status' => 'ok']);
}));

// Menu items
$router->get('/api/menu/items', function () use ($menuService) {
    $categoryId = isset($_GET['category_id']) ? (int) $_GET['category_id'] : null;
    $activeOnly = isset($_GET['active_only']) && $_GET['active_only'] === '1';
    $sku = isset($_GET['sku']) ? (string) $_GET['sku'] : null;
    json_response($menuService->listItems($categoryId, $activeOnly, $sku));
});
$router->post('/api/menu/items', guarded($authService, ['admin'], function () use ($menuService) {
    json_response($menuService->createItem(json_body()), 201);
}));
$router->put('/api/menu/items/{id}', guarded($authService, ['admin'], function (array $p) use ($menuService) {
    json_response($menuService->updateItem((int) $p['id'], json_body()));
}));
$router->delete('/api/menu/items/{id}', guarded($authService, ['admin'], function (array $p) use ($menuService) {
    $menuService->deleteItem((int) $p['id']);
    json_response(['status' => 'ok']);
}));

// Dining tables
$router->get('/api/tables', function () use ($pdo) {
    json_response($pdo->query('SELECT * FROM dining_tables ORDER BY label')->fetchAll());
});
$router->post('/api/tables', guarded($authService, ['admin'], function () use ($pdo) {
    $input = json_body();
    $stmt = $pdo->prepare('INSERT INTO dining_tables (label, seats, pos_x, pos_y) VALUES (:label, :seats, :pos_x, :pos_y)');
    $stmt->execute([
        'label' => (string) ($input['label'] ?? ''),
        'seats' => (int) ($input['seats'] ?? 2),
        'pos_x' => (float) ($input['pos_x'] ?? 0),
        'pos_y' => (float) ($input['pos_y'] ?? 0),
    ]);
    $id = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM dining_tables WHERE id = :id');
    $stmt->execute(['id' => $id]);
    json_response($stmt->fetch(), 201);
}));
$router->put('/api/tables/{id}', guarded($authService, ['admin'], function (array $p) use ($pdo) {
    $input = json_body();
    $stmt = $pdo->prepare('UPDATE dining_tables SET label = COALESCE(:label, label), seats = COALESCE(:seats, seats), status = COALESCE(:status, status) WHERE id = :id');
    $stmt->execute([
        'label' => $input['label'] ?? null,
        'seats' => isset($input['seats']) ? (int) $input['seats'] : null,
        'status' => $input['status'] ?? null,
        'id' => (int) $p['id'],
    ]);
    $stmt = $pdo->prepare('SELECT * FROM dining_tables WHERE id = :id');
    $stmt->execute(['id' => (int) $p['id']]);
    json_response($stmt->fetch());
}));

// Shifts
$router->get('/api/shifts/current', guarded($authService, ['waiter', 'admin'], function () use ($shiftService) {
    $shift = $shiftService->getCurrent();
    json_response($shift ?? ['status' => 'none']);
}));
$router->post('/api/shifts/open', guarded($authService, ['waiter', 'admin'], function () use ($shiftService) {
    json_response($shiftService->open(json_body()), 201);
}));
$router->post('/api/shifts/{id}/close', guarded($authService, ['waiter', 'admin'], function (array $p) use ($shiftService, $backupService) {
    $result = $shiftService->close((int) $p['id'], json_body());
    try {
        $backupService->create('shift-close');
    } catch (Throwable $e) {
        // A failed backup shouldn't block the shift from closing.
        error_log('Backup after shift close failed: ' . $e->getMessage());
    }
    json_response($result);
}));

// Backups — admin only
$router->get('/api/backups', guarded($authService, ['admin'], function () use ($backupService) {
    json_response($backupService->list());
}));
$router->post('/api/backups', guarded($authService, ['admin'], function () use ($backupService) {
    json_response($backupService->create('manual'), 201);
}));

// Settings
$router->get('/api/settings', function () use ($settingsService) {
    json_response($settingsService->all());
});
$router->put('/api/settings', guarded($authService, ['admin'], function () use ($settingsService) {
    json_response($settingsService->update(json_body()));
}));

// Taxes
$router->get('/api/taxes', function () use ($settingsService) {
    json_response($settingsService->listTaxes());
});
$router->put('/api/taxes/{id}', guarded($authService, ['admin'], function (array $p) use ($settingsService) {
    json_response($settingsService->updateTax((int) $p['id'], json_body()));
}));

// Orders — reads shared across all roles (Waiter/Kitchen both need order
// state); item-status transitions are Kitchen's job; everything else that
// mutates an order is Waiter's.
$router->get('/api/orders', guarded($authService, ['waiter', 'kitchen', 'admin'], function () use ($orderService) {
    $full = isset($_GET['full']) && $_GET['full'] === '1';
    json_response($full ? $orderService->listFull($_GET['status'] ?? null) : $orderService->list($_GET['status'] ?? null));
}));
$router->post('/api/orders', guarded($authService, ['waiter', 'admin'], function () use ($orderService) {
    json_response($orderService->create(json_body()), 201);
}));
$router->get('/api/orders/{id}', guarded($authService, ['waiter', 'kitchen', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->getFull((int) $p['id']));
}));
$router->post('/api/orders/{id}/items', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->addItem((int) $p['id'], json_body()), 201);
}));
$router->put('/api/orders/{id}/items/{itemId}', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->updateItem((int) $p['id'], (int) $p['itemId'], json_body()));
}));
$router->delete('/api/orders/{id}/items/{itemId}', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->voidItem((int) $p['id'], (int) $p['itemId']));
}));
$router->put('/api/orders/{id}/items/{itemId}/status', guarded($authService, ['kitchen', 'admin'], function (array $p) use ($orderService) {
    $input = json_body();
    json_response($orderService->updateItemStatus((int) $p['id'], (int) $p['itemId'], (string) ($input['status'] ?? '')));
}));
$router->post('/api/orders/{id}/discounts', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->applyDiscount((int) $p['id'], json_body()), 201);
}));
$router->delete('/api/orders/{id}/discounts/{discountId}', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->removeDiscount((int) $p['id'], (int) $p['discountId']));
}));
$router->post('/api/orders/{id}/send', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->sendToKitchen((int) $p['id']));
}));
$router->put('/api/orders/{id}/customer', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    $input = json_body();
    json_response($orderService->updateCustomerName((int) $p['id'], $input['customer_name'] ?? null));
}));
$router->post('/api/orders/{id}/void', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->voidOrder((int) $p['id']));
}));
$router->post('/api/orders/{id}/payments', guarded($authService, ['waiter', 'admin'], function (array $p) use ($orderService) {
    json_response($orderService->recordPayment((int) $p['id'], json_body()), 201);
}));

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Session-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $router->dispatch($_SERVER['REQUEST_METHOD'], $requestUri);
} catch (InvalidArgumentException $e) {
    json_error($e->getMessage(), 422);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 409);
} catch (Throwable $e) {
    json_error('Internal error: ' . $e->getMessage(), 500);
}
