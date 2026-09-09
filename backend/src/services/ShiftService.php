<?php

declare(strict_types=1);

final class ShiftService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function getCurrent(): ?array
    {
        $stmt = $this->pdo->query('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function open(array $input): array
    {
        if ($this->getCurrent() !== null) {
            throw new RuntimeException('A shift is already open');
        }

        $openingCash = (int) ($input['opening_cash_cents'] ?? 0);
        if ($openingCash < 0) {
            throw new InvalidArgumentException('opening_cash_cents must be non-negative');
        }

        $stmt = $this->pdo->prepare('INSERT INTO shifts (opening_cash_cents, notes) VALUES (:opening_cash_cents, :notes)');
        $stmt->execute([
            'opening_cash_cents' => $openingCash,
            'notes' => $input['notes'] ?? null,
        ]);

        $shiftId = (int) $this->pdo->lastInsertId();
        log_audit($this->pdo, 'shift', $shiftId, 'open', ['opening_cash_cents' => $openingCash]);

        return $this->find($shiftId);
    }

    public function close(int $id, array $input): array
    {
        $shift = $this->find($id);
        if ($shift === null) {
            throw new RuntimeException('Shift not found');
        }
        if ($shift['closed_at'] !== null) {
            throw new RuntimeException('Shift is already closed');
        }

        $stmt = $this->pdo->prepare(
            'SELECT COALESCE(SUM(p.amount_cents), 0)
             FROM payments p
             JOIN orders o ON o.id = p.order_id
             WHERE o.shift_id = :shift_id AND p.method = \'cash\''
        );
        $stmt->execute(['shift_id' => $id]);
        $cashCollected = (int) $stmt->fetchColumn();

        $expected = (int) $shift['opening_cash_cents'] + $cashCollected;
        $actual = (int) ($input['closing_cash_actual_cents'] ?? $expected);
        $difference = $actual - $expected;

        $stmt = $this->pdo->prepare(
            'UPDATE shifts SET
                closed_at = datetime(\'now\'),
                closing_cash_expected_cents = :expected,
                closing_cash_actual_cents = :actual,
                cash_difference_cents = :difference,
                notes = COALESCE(:notes, notes)
             WHERE id = :id'
        );
        $stmt->execute([
            'expected' => $expected,
            'actual' => $actual,
            'difference' => $difference,
            'notes' => $input['notes'] ?? null,
            'id' => $id,
        ]);

        log_audit($this->pdo, 'shift', $id, 'close', [
            'expected' => $expected,
            'actual' => $actual,
            'difference' => $difference,
        ]);

        return $this->find($id);
    }

    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM shifts WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }
}
