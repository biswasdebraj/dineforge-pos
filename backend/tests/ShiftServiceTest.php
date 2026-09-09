<?php

declare(strict_types=1);

final class ShiftServiceTest extends TestCase
{
    public function testOpenAndGetCurrent(): void
    {
        $shifts = new ShiftService($this->pdo);
        $shift = $shifts->open(['opening_cash_cents' => 10000]);

        $this->assertSame(10000, $shift['opening_cash_cents']);
        $this->assertNull($shift['closed_at']);

        $current = $shifts->getCurrent();
        $this->assertSame($shift['id'], $current['id']);
    }

    public function testCannotOpenSecondShiftWhileOneIsOpen(): void
    {
        $shifts = new ShiftService($this->pdo);
        $shifts->open(['opening_cash_cents' => 10000]);

        $this->expectException(RuntimeException::class);
        $shifts->open(['opening_cash_cents' => 5000]);
    }

    public function testCloseReconcilesCashExactly(): void
    {
        $menu = new MenuService($this->pdo);
        $orders = new OrderService($this->pdo);
        $shifts = new ShiftService($this->pdo);

        $shift = $shifts->open(['opening_cash_cents' => 10000]);

        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id'], 'Burger', 950);
        $order = $orders->create([]);
        $order = $orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $orders->recordPayment((int) $order['id'], ['method' => 'cash', 'amount_cents' => 950, 'tendered_cents' => 950]);

        $closed = $shifts->close((int) $shift['id'], ['closing_cash_actual_cents' => 10950]);

        $this->assertSame(10950, $closed['closing_cash_expected_cents']);
        $this->assertSame(10950, $closed['closing_cash_actual_cents']);
        $this->assertSame(0, $closed['cash_difference_cents']);
    }

    public function testCloseDetectsCashShortage(): void
    {
        $shifts = new ShiftService($this->pdo);
        $shift = $shifts->open(['opening_cash_cents' => 10000]);

        $closed = $shifts->close((int) $shift['id'], ['closing_cash_actual_cents' => 9800]);

        $this->assertSame(-200, $closed['cash_difference_cents']);
    }

    public function testCannotCloseAlreadyClosedShift(): void
    {
        $shifts = new ShiftService($this->pdo);
        $shift = $shifts->open(['opening_cash_cents' => 10000]);
        $shifts->close((int) $shift['id'], ['closing_cash_actual_cents' => 10000]);

        $this->expectException(RuntimeException::class);
        $shifts->close((int) $shift['id'], ['closing_cash_actual_cents' => 10000]);
    }

    public function testCardPaymentsDoNotAffectCashReconciliation(): void
    {
        $menu = new MenuService($this->pdo);
        $orders = new OrderService($this->pdo);
        $shifts = new ShiftService($this->pdo);

        $shift = $shifts->open(['opening_cash_cents' => 10000]);
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id'], 'Burger', 950);
        $order = $orders->create([]);
        $orders->addItem((int) $order['id'], ['menu_item_id' => $item['id'], 'quantity' => 1]);
        $orders->recordPayment((int) $order['id'], ['method' => 'card', 'amount_cents' => 950]);

        $closed = $shifts->close((int) $shift['id'], ['closing_cash_actual_cents' => 10000]);

        // Card payment shouldn't count toward expected cash in the drawer.
        $this->assertSame(10000, $closed['closing_cash_expected_cents']);
        $this->assertSame(0, $closed['cash_difference_cents']);
    }
}
