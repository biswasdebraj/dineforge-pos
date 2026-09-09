<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected PDO $pdo;

    protected function setUp(): void
    {
        parent::setUp();

        $this->pdo = new PDO('sqlite::memory:');
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        run_migrations($this->pdo);
    }

    protected function makeCategory(MenuService $menu, string $name = 'Test Category'): array
    {
        return $menu->createCategory(['name' => $name]);
    }

    protected function makeItem(MenuService $menu, int $categoryId, string $name = 'Test Item', int $priceCents = 1000): array
    {
        return $menu->createItem([
            'category_id' => $categoryId,
            'name' => $name,
            'price_cents' => $priceCents,
        ]);
    }
}
