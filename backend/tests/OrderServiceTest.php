<?php

declare(strict_types=1);

final class OrderServiceTest extends TestCase
{
    private MenuService $menu;
    private OrderService $orders;

    protected function setUp(): void
    {
        parent::setUp();
        $this->menu = new MenuService($this->pdo);
        $this->orders = new OrderService($this->pdo);
    }

    private function setTaxRate(float $percent): void
    {
        $this->pdo->exec("UPDATE taxes SET rate_percent = {$percent} WHERE is_default = 1");
    }

    private function setSetting(string $key, string $value): void
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO settings (key, value) VALUES (:key, :value)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        );
        $stmt->execute(['key' => $key, 'value' => $value]);
    }

    public function testCreateOrderGeneratesSequentialOrderNumber(): void
    {
        $a = $this->orders->create([]);
        $b = $this->orders->create([]);

        $this->assertStringEndsWith('-0001', $a['order_number']);
        $this->assertStringEndsWith('-0002', $b['order_number']);
        $this->assertSame('open', $a['status']);
    }

    public function testCreateOrderStoresCustomerName(): void
    {
        $order = $this->orders->create(['customer_name' => '  John Smith  ']);
        $this->assertSame('John Smith', $order['customer_name']);

        $blank = $this->orders->create(['customer_name' => '   ']);
        $this->assertNull($blank['customer_name']);
    }

    public function testUpdateCustomerName(): void
    {
        $order = $this->orders->create([]);
        $this->assertNull($order['customer_name']);

        $updated = $this->orders->updateCustomerName((int) $order['id'], 'Jane Doe');
        $this->assertSame('Jane Doe', $updated['customer_name']);

        $cleared = $this->orders->updateCustomerName((int) $order['id'], '');
        $this->assertNull($cleared['customer_name']);
    }

    public function testCreateOrderRejectsInvalidType(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->orders->create(['order_type' => 'bogus']);
    }

    public function testDeliveryOrderGetsDefaultDeliveryAndPackagingFee(): void
    {
        $this->setSetting('delivery_fee_default_cents', '150');
        $this->setSetting('packaging_fee_default_cents', '50');

        $order = $this->orders->create(['order_type' => 'delivery']);

        $this->assertSame(150, $order['delivery_fee_cents']);
        $this->assertSame(50, $order['packaging_fee_cents']);
    }

    public function testTakeawayOrderGetsPackagingFeeOnlyNotDelivery(): void
    {
        $this->setSetting('delivery_fee_default_cents', '150');
        $this->setSetting('packaging_fee_default_cents', '50');

        $order = $this->orders->create(['order_type' => 'takeaway']);

        $this->assertSame(0, $order['delivery_fee_cents']);
        $this->assertSame(50, $order['packaging_fee_cents']);
    }

    public function testDineInOrderGetsNoCharges(): void
    {
        $this->setSetting('delivery_fee_default_cents', '150');
        $this->setSetting('packaging_fee_default_cents', '50');

        $order = $this->orders->create(['order_type' => 'dine_in']);

        $this->assertSame(0, $order['delivery_fee_cents']);
        $this->assertSame(0, $order['packaging_fee_cents']);
    }

    public function testChargesAreIncludedInTaxableTotal(): void
    {
        $this->setTaxRate(10);
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $order = $this->orders->create(['order_type' => 'delivery']);
        $order = $this->orders->updateCharges((int) $order['id'], 200, 100);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        // subtotal 1000 + delivery 200 + packaging 100 = 1300 taxable, 10% tax = 130
        $this->assertSame(1000, $order['subtotal_cents']);
        $this->assertSame(130, $order['tax_total_cents']);
        $this->assertSame(1430, $order['total_cents']);
    }

    public function testUpdateChargesPartiallyOverrides(): void
    {
        $order = $this->orders->create(['order_type' => 'delivery']);
        $updated = $this->orders->updateCharges((int) $order['id'], 300, null);

        $this->assertSame(300, $updated['delivery_fee_cents']);
        $this->assertSame($order['packaging_fee_cents'], $updated['packaging_fee_cents']);
    }

    public function testCompositeSchemeChargesNoTax(): void
    {
        $this->setTaxRate(10);
        $this->setSetting('gst_scheme', 'composite');
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        $this->assertSame(0, $order['tax_total_cents']);
        $this->assertSame(1000, $order['total_cents']);
    }

    public function testAddItemComputesSubtotal(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 950);
        $order = $this->orders->create([]);

        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 2]);

        $this->assertSame(1900, $order['subtotal_cents']);
        $this->assertSame(1900, $order['total_cents']);
    }

    public function testAddItemRejectsInactiveMenuItem(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id']);
        $this->menu->updateItem((int) $item['id'], ['is_active' => false]);
        $order = $this->orders->create([]);

        $this->expectException(InvalidArgumentException::class);
        $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
    }

    public function testAddItemWithModifiersAddsToPrice(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 950);

        $this->pdo->exec("INSERT INTO modifier_groups (name) VALUES ('Extras')");
        $groupId = (int) $this->pdo->lastInsertId();
        $this->pdo->exec("INSERT INTO modifiers (group_id, name, price_delta_cents) VALUES ({$groupId}, 'Extra cheese', 150)");
        $modId = (int) $this->pdo->lastInsertId();

        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], [
            'menu_item_id' => $item['id'],
            'quantity' => 1,
            'modifier_ids' => [$modId],
        ]);

        $this->assertSame(1100, $order['subtotal_cents']); // 950 + 150
        $this->assertCount(1, $order['items'][0]['modifiers']);
    }

    public function testUpdateItemQuantityRecalculatesTotal(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 950);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $itemRowId = (int) $order['items'][0]['id'];

        $order = $this->orders->updateItem((int) $order['id'], $itemRowId, ['quantity' => 3]);

        $this->assertSame(2850, $order['subtotal_cents']);
    }

    public function testVoidItemExcludesFromTotals(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 950);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 2]);
        $itemRowId = (int) $order['items'][0]['id'];

        $order = $this->orders->voidItem((int) $order['id'], $itemRowId);

        $this->assertSame(0, $order['subtotal_cents']);
        $this->assertSame('void', $order['items'][0]['status']);
    }

    public function testPercentDiscountRounding(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 333);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        // 10% of 333 = 33.3, should round to 33.
        $order = $this->orders->applyDiscount((int) $order['id'], ['type' => 'percent', 'value' => 10]);

        $this->assertSame(33, $order['discount_total_cents']);
        $this->assertSame(300, $order['total_cents']);
    }

    public function testDiscountCannotExceedSubtotal(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 500);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        $order = $this->orders->applyDiscount((int) $order['id'], ['type' => 'fixed', 'value' => 50]);

        $this->assertSame(500, $order['discount_total_cents']); // capped, not 5000
        $this->assertSame(0, $order['total_cents']);
    }

    public function testTaxAppliesAfterDiscount(): void
    {
        $this->setTaxRate(8.5);
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 2000);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $order = $this->orders->applyDiscount((int) $order['id'], ['type' => 'fixed', 'value' => 5]);

        // Taxable = 2000 - 500 = 1500; tax = 1500 * 8.5% = 127.5 -> rounds to 128.
        $this->assertSame(128, $order['tax_total_cents']);
        $this->assertSame(1628, $order['total_cents']);
    }

    public function testRemoveDiscountResetsTotals(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 1000);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $order = $this->orders->applyDiscount((int) $order['id'], ['type' => 'fixed', 'value' => 2]);
        $discountRowId = (int) $order['discounts'][0]['id'];

        $order = $this->orders->removeDiscount((int) $order['id'], $discountRowId);

        $this->assertSame(0, $order['discount_total_cents']);
        $this->assertSame(1000, $order['total_cents']);
    }

    public function testSendToKitchenMarksPendingItemsSent(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id']);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        $order = $this->orders->sendToKitchen((int) $order['id']);

        $this->assertSame('sent_to_kitchen', $order['status']);
        $this->assertSame('sent', $order['items'][0]['status']);
    }

    public function testCannotModifyOrderAfterPaid(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 500);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 500, 'tendered_cents' => 500]);

        $this->expectException(RuntimeException::class);
        $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
    }

    public function testCannotVoidPaidOrder(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 500);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 500, 'tendered_cents' => 500]);

        $this->expectException(RuntimeException::class);
        $this->orders->voidOrder((int) $order['id']);
    }

    public function testPartialPaymentDoesNotCloseOrder(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 1000);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        $order = $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 400]);

        $this->assertSame('open', $order['status']);

        $order = $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 600, 'tendered_cents' => 600]);

        $this->assertSame('paid', $order['status']);
        $this->assertNotNull($order['closed_at']);
    }

    public function testCashPaymentChangeDue(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 950);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);

        $order = $this->orders->recordPayment((int) $order['id'], [
            'method' => 'cash',
            'amount_cents' => 950,
            'tendered_cents' => 2000,
        ]);

        $this->assertSame(1050, $order['payments'][0]['change_due_cents']);
    }

    public function testVoidOrderPreventsFurtherPayment(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Item', 500);
        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $this->orders->voidOrder((int) $order['id']);

        $this->expectException(RuntimeException::class);
        $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 500]);
    }

    public function testSearchFiltersByStatus(): void
    {
        $open = $this->orders->create([]);
        $toVoid = $this->orders->create([]);
        $this->orders->voidOrder((int) $toVoid['id']);

        $results = $this->orders->search(['status' => 'void']);

        $this->assertCount(1, $results);
        $this->assertSame((int) $toVoid['id'], (int) $results[0]['id']);
    }

    public function testSearchFiltersByOrderType(): void
    {
        $this->orders->create(['order_type' => 'dine_in']);
        $delivery = $this->orders->create(['order_type' => 'delivery']);

        $results = $this->orders->search(['order_type' => 'delivery']);

        $this->assertCount(1, $results);
        $this->assertSame((int) $delivery['id'], (int) $results[0]['id']);
    }

    public function testSearchFiltersByDateRange(): void
    {
        $order = $this->orders->create([]);
        $this->pdo->prepare('UPDATE orders SET opened_at = :dt WHERE id = :id')
            ->execute(['dt' => '2020-01-01 10:00:00', 'id' => $order['id']]);

        $this->assertCount(0, $this->orders->search(['date_from' => '2025-01-01']));
        $this->assertCount(1, $this->orders->search(['date_to' => '2020-12-31']));
    }

    public function testSearchWithNoFiltersReturnsAllOrdersNewestFirst(): void
    {
        $first = $this->orders->create([]);
        $second = $this->orders->create([]);

        $results = $this->orders->search([]);

        $this->assertCount(2, $results);
        $this->assertSame((int) $second['id'], (int) $results[0]['id']);
        $this->assertSame((int) $first['id'], (int) $results[1]['id']);
    }
}
