<?php

declare(strict_types=1);

final class SettingsService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function all(): array
    {
        $rows = $this->pdo->query('SELECT key, value FROM settings')->fetchAll();
        $map = [];
        foreach ($rows as $row) {
            $map[$row['key']] = $row['value'];
        }
        return $map;
    }

    public function update(array $input): array
    {
        $stmt = $this->pdo->prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        );

        foreach ($input as $key => $value) {
            $stmt->execute(['key' => (string) $key, 'value' => (string) $value]);
        }

        return $this->all();
    }

    public function listTaxes(): array
    {
        return $this->pdo->query('SELECT * FROM taxes ORDER BY name')->fetchAll();
    }

    public function updateTax(int $id, array $input): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM taxes WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $tax = $stmt->fetch();
        if ($tax === false) {
            throw new RuntimeException('Tax not found');
        }

        $makeDefault = isset($input['is_default']) && (bool) $input['is_default'];

        $this->pdo->beginTransaction();
        try {
            if ($makeDefault) {
                $this->pdo->exec('UPDATE taxes SET is_default = 0');
            }

            $update = $this->pdo->prepare(
                'UPDATE taxes SET name = :name, rate_percent = :rate_percent, is_default = :is_default, is_active = :is_active WHERE id = :id'
            );
            $update->execute([
                'name' => (string) ($input['name'] ?? $tax['name']),
                'rate_percent' => (float) ($input['rate_percent'] ?? $tax['rate_percent']),
                'is_default' => $makeDefault ? 1 : (int) $tax['is_default'],
                'is_active' => isset($input['is_active']) ? (int) (bool) $input['is_active'] : (int) $tax['is_active'],
                'id' => $id,
            ]);

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }
}
