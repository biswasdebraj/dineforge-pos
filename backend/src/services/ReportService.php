<?php

declare(strict_types=1);

final class ReportService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function dailySales(string $date): array
    {
        $ordersStmt = $this->pdo->prepare(
            "SELECT * FROM orders WHERE status = 'paid' AND DATE(closed_at) = :date ORDER BY closed_at"
        );
        $ordersStmt->execute(['date' => $date]);
        $orders = $ordersStmt->fetchAll();

        $summary = [
            'date' => $date,
            'order_count' => count($orders),
            'subtotal_cents' => 0,
            'discount_total_cents' => 0,
            'delivery_fee_cents' => 0,
            'packaging_fee_cents' => 0,
            'tax_total_cents' => 0,
            'total_cents' => 0,
            'by_order_type' => ['dine_in' => 0, 'takeaway' => 0, 'delivery' => 0],
            'by_payment_method' => ['cash' => 0, 'card' => 0, 'other' => 0],
        ];

        $orderIds = [];
        foreach ($orders as $order) {
            $orderIds[] = (int) $order['id'];
            $summary['subtotal_cents'] += (int) $order['subtotal_cents'];
            $summary['discount_total_cents'] += (int) $order['discount_total_cents'];
            $summary['delivery_fee_cents'] += (int) $order['delivery_fee_cents'];
            $summary['packaging_fee_cents'] += (int) $order['packaging_fee_cents'];
            $summary['tax_total_cents'] += (int) $order['tax_total_cents'];
            $summary['total_cents'] += (int) $order['total_cents'];
            $summary['by_order_type'][$order['order_type']] =
                ($summary['by_order_type'][$order['order_type']] ?? 0) + (int) $order['total_cents'];
        }

        if ($orderIds !== []) {
            $placeholders = implode(',', array_fill(0, count($orderIds), '?'));
            $paymentsStmt = $this->pdo->prepare(
                "SELECT method, SUM(amount_cents) as total FROM payments WHERE order_id IN ($placeholders) GROUP BY method"
            );
            $paymentsStmt->execute($orderIds);
            foreach ($paymentsStmt->fetchAll() as $row) {
                $summary['by_payment_method'][$row['method']] = (int) $row['total'];
            }
        }

        return $summary;
    }
}
