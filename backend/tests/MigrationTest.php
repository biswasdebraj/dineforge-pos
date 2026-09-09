<?php

declare(strict_types=1);

final class MigrationTest extends TestCase
{
    public function testMigrationsAreIdempotent(): void
    {
        $before = (int) $this->pdo->query('SELECT COUNT(*) FROM _migrations')->fetchColumn();

        run_migrations($this->pdo); // setUp() already ran it once

        $after = (int) $this->pdo->query('SELECT COUNT(*) FROM _migrations')->fetchColumn();

        $this->assertGreaterThan(0, $before);
        $this->assertSame($before, $after);
    }

    public function testForeignKeysAreEnforced(): void
    {
        $this->expectException(PDOException::class);
        $this->pdo->exec('INSERT INTO menu_items (category_id, name, price_cents) VALUES (999, \'Ghost\', 500)');
    }

    public function testSeedDataPresent(): void
    {
        $currency = $this->pdo->query("SELECT value FROM settings WHERE key = 'currency'")->fetchColumn();
        $taxCount = (int) $this->pdo->query('SELECT COUNT(*) FROM taxes WHERE is_default = 1')->fetchColumn();

        $this->assertSame('USD', $currency);
        $this->assertSame(1, $taxCount);
    }
}
