<?php

declare(strict_types=1);

final class OrderService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function list(?string $status = null): array
    {
        if ($status !== null) {
            $stmt = $this->pdo->prepare('SELECT * FROM orders WHERE status = :status ORDER BY id DESC');
            $stmt->execute(['status' => $status]);
        } else {
            $stmt = $this->pdo->query('SELECT * FROM orders ORDER BY id DESC');
        }

        return $stmt->fetchAll();
    }

    public function create(array $input): array
    {
        $orderType = $input['order_type'] ?? 'dine_in';
        if (!in_array($orderType, ['dine_in', 'takeaway', 'delivery'], true)) {
            throw new InvalidArgumentException('invalid order_type');
        }

        $tableId = isset($input['table_id']) ? (int) $input['table_id'] : null;

        $shiftStmt = $this->pdo->query('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
        $shiftId = $shiftStmt->fetchColumn();
        $shiftId = $shiftId === false ? null : (int) $shiftId;

        $orderNumber = $this->generateOrderNumber();

        $stmt = $this->pdo->prepare(
            'INSERT INTO orders (order_number, shift_id, table_id, order_type, notes)
             VALUES (:order_number, :shift_id, :table_id, :order_type, :notes)'
        );
        $stmt->execute([
            'order_number' => $orderNumber,
            'shift_id' => $shiftId,
            'table_id' => $tableId,
            'order_type' => $orderType,
            'notes' => $input['notes'] ?? null,
        ]);

        $orderId = (int) $this->pdo->lastInsertId();
        log_audit($this->pdo, 'order', $orderId, 'create', ['order_number' => $orderNumber]);

        return $this->getFull($orderId);
    }

    private function generateOrderNumber(): string
    {
        $today = date('Ymd');
        $stmt = $this->pdo->prepare(
            "SELECT COUNT(*) FROM orders WHERE order_number LIKE :prefix"
        );
        $stmt->execute(['prefix' => $today . '-%']);
        $countToday = (int) $stmt->fetchColumn();

        return sprintf('%s-%04d', $today, $countToday + 1);
    }

    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM orders WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function getFull(int $id): array
    {
        $order = $this->find($id);
        if ($order === null) {
            throw new RuntimeException('Order not found');
        }

        $itemsStmt = $this->pdo->prepare('SELECT * FROM order_items WHERE order_id = :id ORDER BY id');
        $itemsStmt->execute(['id' => $id]);
        $items = $itemsStmt->fetchAll();

        foreach ($items as &$item) {
            $modStmt = $this->pdo->prepare('SELECT * FROM order_item_modifiers WHERE order_item_id = :id');
            $modStmt->execute(['id' => $item['id']]);
            $item['modifiers'] = $modStmt->fetchAll();
        }
        unset($item);

        $discountsStmt = $this->pdo->prepare('SELECT * FROM order_discounts WHERE order_id = :id');
        $discountsStmt->execute(['id' => $id]);
        $order['discounts'] = $discountsStmt->fetchAll();

        $paymentsStmt = $this->pdo->prepare('SELECT * FROM payments WHERE order_id = :id ORDER BY id');
        $paymentsStmt->execute(['id' => $id]);
        $order['payments'] = $paymentsStmt->fetchAll();

        $order['items'] = $items;

        return $order;
    }

    private function transact(callable $fn)
    {
        $this->pdo->beginTransaction();
        try {
            $result = $fn();
            $this->pdo->commit();
            return $result;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function requireOpenOrder(int $orderId): array
    {
        $order = $this->find($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found');
        }
        if (!in_array($order['status'], ['open', 'sent_to_kitchen'], true)) {
            throw new RuntimeException('Order is not open for changes');
        }
        return $order;
    }

    public function addItem(int $orderId, array $input): array
    {
        $this->requireOpenOrder($orderId);

        $menuItemId = (int) ($input['menu_item_id'] ?? 0);
        $quantity = (int) ($input['quantity'] ?? 1);
        if ($quantity < 1) {
            throw new InvalidArgumentException('quantity must be at least 1');
        }

        $itemStmt = $this->pdo->prepare('SELECT * FROM menu_items WHERE id = :id AND is_active = 1');
        $itemStmt->execute(['id' => $menuItemId]);
        $menuItem = $itemStmt->fetch();
        if ($menuItem === false) {
            throw new InvalidArgumentException('menu item not found or inactive');
        }

        return $this->transact(function () use ($orderId, $menuItemId, $menuItem, $quantity, $input) {
            $stmt = $this->pdo->prepare(
                'INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price_cents, quantity, notes)
                 VALUES (:order_id, :menu_item_id, :item_name, :unit_price_cents, :quantity, :notes)'
            );
            $stmt->execute([
                'order_id' => $orderId,
                'menu_item_id' => $menuItemId,
                'item_name' => $menuItem['name'],
                'unit_price_cents' => $menuItem['price_cents'],
                'quantity' => $quantity,
                'notes' => $input['notes'] ?? null,
            ]);
            $orderItemId = (int) $this->pdo->lastInsertId();

            foreach ($input['modifier_ids'] ?? [] as $modifierId) {
                $modStmt = $this->pdo->prepare('SELECT * FROM modifiers WHERE id = :id AND is_active = 1');
                $modStmt->execute(['id' => (int) $modifierId]);
                $modifier = $modStmt->fetch();
                if ($modifier === false) {
                    throw new InvalidArgumentException("modifier {$modifierId} not found or inactive");
                }

                $insertMod = $this->pdo->prepare(
                    'INSERT INTO order_item_modifiers (order_item_id, modifier_id, modifier_name, price_delta_cents)
                     VALUES (:order_item_id, :modifier_id, :modifier_name, :price_delta_cents)'
                );
                $insertMod->execute([
                    'order_item_id' => $orderItemId,
                    'modifier_id' => $modifier['id'],
                    'modifier_name' => $modifier['name'],
                    'price_delta_cents' => $modifier['price_delta_cents'],
                ]);
            }

            $this->recalculateTotals($orderId);
            return $this->getFull($orderId);
        });
    }

    public function updateItem(int $orderId, int $itemId, array $input): array
    {
        $this->requireOpenOrder($orderId);

        $itemStmt = $this->pdo->prepare('SELECT * FROM order_items WHERE id = :id AND order_id = :order_id');
        $itemStmt->execute(['id' => $itemId, 'order_id' => $orderId]);
        $item = $itemStmt->fetch();
        if ($item === false) {
            throw new RuntimeException('Order item not found');
        }

        $quantity = (int) ($input['quantity'] ?? $item['quantity']);
        if ($quantity < 1) {
            throw new InvalidArgumentException('quantity must be at least 1');
        }

        return $this->transact(function () use ($orderId, $itemId, $quantity, $input, $item) {
            $stmt = $this->pdo->prepare(
                'UPDATE order_items SET quantity = :quantity, notes = :notes WHERE id = :id'
            );
            $stmt->execute([
                'quantity' => $quantity,
                'notes' => $input['notes'] ?? $item['notes'],
                'id' => $itemId,
            ]);

            $this->recalculateTotals($orderId);
            return $this->getFull($orderId);
        });
    }

    public function updateItemStatus(int $orderId, int $itemId, string $status): array
    {
        if (!in_array($status, ['pending', 'sent', 'preparing', 'ready', 'served'], true)) {
            throw new InvalidArgumentException('invalid item status');
        }

        $itemStmt = $this->pdo->prepare('SELECT * FROM order_items WHERE id = :id AND order_id = :order_id');
        $itemStmt->execute(['id' => $itemId, 'order_id' => $orderId]);
        if ($itemStmt->fetch() === false) {
            throw new RuntimeException('Order item not found');
        }

        $stmt = $this->pdo->prepare('UPDATE order_items SET status = :status WHERE id = :id');
        $stmt->execute(['status' => $status, 'id' => $itemId]);

        return $this->getFull($orderId);
    }

    public function listFull(?string $status = null): array
    {
        $orders = $this->list($status);
        return array_map(fn (array $order) => $this->getFull((int) $order['id']), $orders);
    }

    public function voidItem(int $orderId, int $itemId): array
    {
        $this->requireOpenOrder($orderId);

        return $this->transact(function () use ($orderId, $itemId) {
            $stmt = $this->pdo->prepare('UPDATE order_items SET status = \'void\' WHERE id = :id AND order_id = :order_id');
            $stmt->execute(['id' => $itemId, 'order_id' => $orderId]);

            log_audit($this->pdo, 'order_item', $itemId, 'void');

            $this->recalculateTotals($orderId);
            return $this->getFull($orderId);
        });
    }

    public function applyDiscount(int $orderId, array $input): array
    {
        $order = $this->requireOpenOrder($orderId);

        $label = $input['label'] ?? null;
        $amountCents = null;

        if (!empty($input['discount_id'])) {
            $discStmt = $this->pdo->prepare('SELECT * FROM discounts WHERE id = :id AND is_active = 1');
            $discStmt->execute(['id' => (int) $input['discount_id']]);
            $discount = $discStmt->fetch();
            if ($discount === false) {
                throw new InvalidArgumentException('discount not found or inactive');
            }

            $subtotal = (int) $order['subtotal_cents'];
            $amountCents = $discount['type'] === 'percent'
                ? (int) round($subtotal * ((float) $discount['value'] / 100))
                : (int) round((float) $discount['value'] * 100);
            $label = $label ?? $discount['name'];
            $discountId = $discount['id'];
        } else {
            $type = $input['type'] ?? 'fixed';
            $value = (float) ($input['value'] ?? 0);
            $subtotal = (int) $order['subtotal_cents'];
            $amountCents = $type === 'percent'
                ? (int) round($subtotal * ($value / 100))
                : (int) round($value * 100);
            $label = $label ?? ($type === 'percent' ? "{$value}% off" : 'Discount');
            $discountId = null;
        }

        return $this->transact(function () use ($orderId, $discountId, $label, $amountCents) {
            $stmt = $this->pdo->prepare(
                'INSERT INTO order_discounts (order_id, discount_id, label, amount_cents)
                 VALUES (:order_id, :discount_id, :label, :amount_cents)'
            );
            $stmt->execute([
                'order_id' => $orderId,
                'discount_id' => $discountId,
                'label' => $label,
                'amount_cents' => $amountCents,
            ]);

            log_audit($this->pdo, 'order', $orderId, 'apply_discount', ['label' => $label, 'amount_cents' => $amountCents]);

            $this->recalculateTotals($orderId);
            return $this->getFull($orderId);
        });
    }

    public function removeDiscount(int $orderId, int $discountRowId): array
    {
        $this->requireOpenOrder($orderId);

        return $this->transact(function () use ($orderId, $discountRowId) {
            $stmt = $this->pdo->prepare('DELETE FROM order_discounts WHERE id = :id AND order_id = :order_id');
            $stmt->execute(['id' => $discountRowId, 'order_id' => $orderId]);

            $this->recalculateTotals($orderId);
            return $this->getFull($orderId);
        });
    }

    public function sendToKitchen(int $orderId): array
    {
        $this->requireOpenOrder($orderId);

        return $this->transact(function () use ($orderId) {
            $this->pdo->prepare('UPDATE orders SET status = \'sent_to_kitchen\' WHERE id = :id')
                ->execute(['id' => $orderId]);

            $this->pdo->prepare("UPDATE order_items SET status = 'sent' WHERE order_id = :id AND status = 'pending'")
                ->execute(['id' => $orderId]);

            log_audit($this->pdo, 'order', $orderId, 'send_to_kitchen');
            return $this->getFull($orderId);
        });
    }

    public function voidOrder(int $orderId): array
    {
        $order = $this->find($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found');
        }
        if ($order['status'] === 'paid' || $order['status'] === 'closed') {
            throw new RuntimeException('Cannot void a paid or closed order');
        }

        $this->pdo->prepare("UPDATE orders SET status = 'void', closed_at = datetime('now') WHERE id = :id")
            ->execute(['id' => $orderId]);

        log_audit($this->pdo, 'order', $orderId, 'void');

        return $this->getFull($orderId);
    }

    public function recordPayment(int $orderId, array $input): array
    {
        $order = $this->find($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found');
        }
        if (in_array($order['status'], ['void', 'closed'], true)) {
            throw new RuntimeException('Order is not payable');
        }

        $method = $input['method'] ?? null;
        if (!in_array($method, ['cash', 'card', 'other'], true)) {
            throw new InvalidArgumentException('invalid payment method');
        }

        $amountCents = (int) ($input['amount_cents'] ?? 0);
        if ($amountCents <= 0) {
            throw new InvalidArgumentException('amount_cents must be positive');
        }

        $tenderedCents = isset($input['tendered_cents']) ? (int) $input['tendered_cents'] : null;
        $changeDueCents = $tenderedCents !== null ? max(0, $tenderedCents - $amountCents) : null;

        return $this->transact(function () use ($orderId, $method, $amountCents, $tenderedCents, $changeDueCents) {
            $stmt = $this->pdo->prepare(
                'INSERT INTO payments (order_id, method, amount_cents, tendered_cents, change_due_cents)
                 VALUES (:order_id, :method, :amount_cents, :tendered_cents, :change_due_cents)'
            );
            $stmt->execute([
                'order_id' => $orderId,
                'method' => $method,
                'amount_cents' => $amountCents,
                'tendered_cents' => $tenderedCents,
                'change_due_cents' => $changeDueCents,
            ]);

            $paidStmt = $this->pdo->prepare('SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE order_id = :id');
            $paidStmt->execute(['id' => $orderId]);
            $totalPaid = (int) $paidStmt->fetchColumn();

            $current = $this->find($orderId);
            if ($totalPaid >= (int) $current['total_cents']) {
                $this->pdo->prepare("UPDATE orders SET status = 'paid', closed_at = datetime('now') WHERE id = :id")
                    ->execute(['id' => $orderId]);
                log_audit($this->pdo, 'order', $orderId, 'paid', ['total_paid_cents' => $totalPaid]);
            }

            return $this->getFull($orderId);
        });
    }

    private function recalculateTotals(int $orderId): void
    {
        $subtotalStmt = $this->pdo->prepare(
            "SELECT COALESCE(SUM(
                (oi.unit_price_cents + COALESCE((
                    SELECT SUM(oim.price_delta_cents) FROM order_item_modifiers oim WHERE oim.order_item_id = oi.id
                ), 0)) * oi.quantity
            ), 0)
             FROM order_items oi
             WHERE oi.order_id = :order_id AND oi.status != 'void'"
        );
        $subtotalStmt->execute(['order_id' => $orderId]);
        $subtotal = (int) $subtotalStmt->fetchColumn();

        $discountStmt = $this->pdo->prepare('SELECT COALESCE(SUM(amount_cents), 0) FROM order_discounts WHERE order_id = :order_id');
        $discountStmt->execute(['order_id' => $orderId]);
        $discountTotal = min($subtotal, (int) $discountStmt->fetchColumn());

        $taxRateStmt = $this->pdo->query('SELECT rate_percent FROM taxes WHERE is_default = 1 AND is_active = 1 LIMIT 1');
        $taxRate = (float) ($taxRateStmt->fetchColumn() ?: 0);

        $taxable = max(0, $subtotal - $discountTotal);
        $taxTotal = (int) round($taxable * ($taxRate / 100));
        $total = $taxable + $taxTotal;

        $stmt = $this->pdo->prepare(
            'UPDATE orders SET subtotal_cents = :subtotal, discount_total_cents = :discount, tax_total_cents = :tax, total_cents = :total WHERE id = :id'
        );
        $stmt->execute([
            'subtotal' => $subtotal,
            'discount' => $discountTotal,
            'tax' => $taxTotal,
            'total' => $total,
            'id' => $orderId,
        ]);
    }
}
