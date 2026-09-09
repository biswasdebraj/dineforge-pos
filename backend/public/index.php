<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/support/response.php';
require_once __DIR__ . '/../src/support/router.php';
require_once __DIR__ . '/../src/support/audit.php';
require_once __DIR__ . '/../src/db/connection.php';
require_once __DIR__ . '/../src/services/MenuService.php';
require_once __DIR__ . '/../src/services/ShiftService.php';
require_once __DIR__ . '/../src/services/OrderService.php';

$pdo = get_db_connection();
$menuService = new MenuService($pdo);
$shiftService = new ShiftService($pdo);
$orderService = new OrderService($pdo);

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

// Menu categories
$router->get('/api/menu/categories', function () use ($menuService) {
    json_response($menuService->listCategories());
});
$router->post('/api/menu/categories', function () use ($menuService) {
    json_response($menuService->createCategory(json_body()), 201);
});
$router->put('/api/menu/categories/{id}', function (array $p) use ($menuService) {
    json_response($menuService->updateCategory((int) $p['id'], json_body()));
});
$router->delete('/api/menu/categories/{id}', function (array $p) use ($menuService) {
    $menuService->deleteCategory((int) $p['id']);
    json_response(['status' => 'ok']);
});

// Menu items
$router->get('/api/menu/items', function () use ($menuService) {
    $categoryId = isset($_GET['category_id']) ? (int) $_GET['category_id'] : null;
    $activeOnly = isset($_GET['active_only']) && $_GET['active_only'] === '1';
    json_response($menuService->listItems($categoryId, $activeOnly));
});
$router->post('/api/menu/items', function () use ($menuService) {
    json_response($menuService->createItem(json_body()), 201);
});
$router->put('/api/menu/items/{id}', function (array $p) use ($menuService) {
    json_response($menuService->updateItem((int) $p['id'], json_body()));
});
$router->delete('/api/menu/items/{id}', function (array $p) use ($menuService) {
    $menuService->deleteItem((int) $p['id']);
    json_response(['status' => 'ok']);
});

// Dining tables
$router->get('/api/tables', function () use ($pdo) {
    json_response($pdo->query('SELECT * FROM dining_tables ORDER BY label')->fetchAll());
});
$router->post('/api/tables', function () use ($pdo) {
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
});
$router->put('/api/tables/{id}', function (array $p) use ($pdo) {
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
});

// Shifts
$router->get('/api/shifts/current', function () use ($shiftService) {
    $shift = $shiftService->getCurrent();
    json_response($shift ?? ['status' => 'none']);
});
$router->post('/api/shifts/open', function () use ($shiftService) {
    json_response($shiftService->open(json_body()), 201);
});
$router->post('/api/shifts/{id}/close', function (array $p) use ($shiftService) {
    json_response($shiftService->close((int) $p['id'], json_body()));
});

// Orders
$router->get('/api/orders', function () use ($orderService) {
    json_response($orderService->list($_GET['status'] ?? null));
});
$router->post('/api/orders', function () use ($orderService) {
    json_response($orderService->create(json_body()), 201);
});
$router->get('/api/orders/{id}', function (array $p) use ($orderService) {
    json_response($orderService->getFull((int) $p['id']));
});
$router->post('/api/orders/{id}/items', function (array $p) use ($orderService) {
    json_response($orderService->addItem((int) $p['id'], json_body()), 201);
});
$router->put('/api/orders/{id}/items/{itemId}', function (array $p) use ($orderService) {
    json_response($orderService->updateItem((int) $p['id'], (int) $p['itemId'], json_body()));
});
$router->delete('/api/orders/{id}/items/{itemId}', function (array $p) use ($orderService) {
    json_response($orderService->voidItem((int) $p['id'], (int) $p['itemId']));
});
$router->post('/api/orders/{id}/discounts', function (array $p) use ($orderService) {
    json_response($orderService->applyDiscount((int) $p['id'], json_body()), 201);
});
$router->delete('/api/orders/{id}/discounts/{discountId}', function (array $p) use ($orderService) {
    json_response($orderService->removeDiscount((int) $p['id'], (int) $p['discountId']));
});
$router->post('/api/orders/{id}/send', function (array $p) use ($orderService) {
    json_response($orderService->sendToKitchen((int) $p['id']));
});
$router->post('/api/orders/{id}/void', function (array $p) use ($orderService) {
    json_response($orderService->voidOrder((int) $p['id']));
});
$router->post('/api/orders/{id}/payments', function (array $p) use ($orderService) {
    json_response($orderService->recordPayment((int) $p['id'], json_body()), 201);
});

header('Access-Control-Allow-Origin: *');

try {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $router->dispatch($_SERVER['REQUEST_METHOD'], $uri);
} catch (InvalidArgumentException $e) {
    json_error($e->getMessage(), 422);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 409);
} catch (Throwable $e) {
    json_error('Internal error: ' . $e->getMessage(), 500);
}
