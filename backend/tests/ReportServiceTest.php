<?php

declare(strict_types=1);

final class ReportServiceTest extends TestCase
{
    private MenuService $menu;
    private OrderService $orders;
    private ReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();
        $this->menu = new MenuService($this->pdo);
        $this->orders = new OrderService($this->pdo);
        $this->reports = new ReportService($this->pdo);
    }

    private function setClosedDate(int $orderId, string $date): void
    {
        $stmt = $this->pdo->prepare("UPDATE orders SET closed_at = :dt WHERE id = :id");
        $stmt->execute(['dt' => $date . ' 12:00:00', 'id' => $orderId]);
    }

    public function testDailySalesAggregatesPaidOrdersForDate(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $order = $this->orders->create(['order_type' => 'dine_in']);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $order = $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => $order['total_cents']]);
        $this->setClosedDate((int) $order['id'], '2026-01-15');

        $report = $this->reports->dailySales('2026-01-15');

        $this->assertSame(1, $report['order_count']);
        $this->assertSame(1000, $report['total_cents']);
        $this->assertSame(1000, $report['by_payment_method']['cash']);
        $this->assertSame(1000, $report['by_order_type']['dine_in']);
    }

    public function testDailySalesExcludesOtherDates(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $order = $this->orders->create([]);
        $order = $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $order = $this->orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => $order['total_cents']]);
        $this->setClosedDate((int) $order['id'], '2026-01-15');

        $report = $this->reports->dailySales('2026-01-16');

        $this->assertSame(0, $report['order_count']);
        $this->assertSame(0, $report['total_cents']);
    }

    public function testDailySalesExcludesUnpaidOrders(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $order = $this->orders->create([]);
        $this->orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        // never paid, closed_at stays null

        $report = $this->reports->dailySales(date('Y-m-d'));

        $this->assertSame(0, $report['order_count']);
    }

    public function testDailySalesBreaksDownMultiplePaymentMethods(): void
    {
        $cat = $this->makeCategory($this->menu);
        $item = $this->makeItem($this->menu, (int) $cat['id'], 'Burger', 1000);

        $cashOrder = $this->orders->create([]);
        $cashOrder = $this->orders->addItem((int) $cashOrder['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $cashOrder = $this->orders->recordPayment((int) $cashOrder['id'], ['method' => 'cash', 'amount_cents' => $cashOrder['total_cents']]);
        $this->setClosedDate((int) $cashOrder['id'], '2026-02-01');

        $cardOrder = $this->orders->create([]);
        $cardOrder = $this->orders->addItem((int) $cardOrder['id'], ['menu_item_id' => $item['id'], 'quantity' => 2]);
        $cardOrder = $this->orders->recordPayment((int) $cardOrder['id'], ['method' => 'card', 'amount_cents' => $cardOrder['total_cents']]);
        $this->setClosedDate((int) $cardOrder['id'], '2026-02-01');

        $report = $this->reports->dailySales('2026-02-01');

        $this->assertSame(2, $report['order_count']);
        $this->assertSame(1000, $report['by_payment_method']['cash']);
        $this->assertSame(2000, $report['by_payment_method']['card']);
        $this->assertSame(3000, $report['total_cents']);
    }
}
