<?php

declare(strict_types=1);

final class MenuService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function listCategories(): array
    {
        return $this->pdo
            ->query('SELECT * FROM menu_categories ORDER BY sort_order, name')
            ->fetchAll();
    }

    public function createCategory(array $input): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO menu_categories (name, sort_order) VALUES (:name, :sort_order)'
        );
        $stmt->execute([
            'name' => $name,
            'sort_order' => (int) ($input['sort_order'] ?? 0),
        ]);

        return $this->findCategory((int) $this->pdo->lastInsertId());
    }

    public function updateCategory(int $id, array $input): array
    {
        $category = $this->findCategory($id);
        if ($category === null) {
            throw new RuntimeException('Category not found');
        }

        $name = isset($input['name']) ? trim((string) $input['name']) : $category['name'];
        if ($name === '') {
            throw new InvalidArgumentException('name cannot be empty');
        }

        $stmt = $this->pdo->prepare(
            'UPDATE menu_categories SET name = :name, sort_order = :sort_order, is_active = :is_active, updated_at = datetime(\'now\') WHERE id = :id'
        );
        $stmt->execute([
            'name' => $name,
            'sort_order' => (int) ($input['sort_order'] ?? $category['sort_order']),
            'is_active' => isset($input['is_active']) ? (int) (bool) $input['is_active'] : (int) $category['is_active'],
            'id' => $id,
        ]);

        return $this->findCategory($id);
    }

    public function deleteCategory(int $id): void
    {
        try {
            $stmt = $this->pdo->prepare('DELETE FROM menu_categories WHERE id = :id');
            $stmt->execute(['id' => $id]);
        } catch (PDOException $e) {
            throw new RuntimeException('Cannot delete category — it still has menu items. Deactivate it instead.', 0, $e);
        }
    }

    public function findCategory(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM menu_categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function listItems(?int $categoryId = null, bool $activeOnly = false): array
    {
        $sql = 'SELECT * FROM menu_items WHERE 1 = 1';
        $params = [];

        if ($categoryId !== null) {
            $sql .= ' AND category_id = :category_id';
            $params['category_id'] = $categoryId;
        }

        if ($activeOnly) {
            $sql .= ' AND is_active = 1';
        }

        $sql .= ' ORDER BY sort_order, name';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function createItem(array $input): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        $categoryId = (int) ($input['category_id'] ?? 0);
        $priceCents = $input['price_cents'] ?? null;

        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }
        if ($categoryId <= 0 || $this->findCategory($categoryId) === null) {
            throw new InvalidArgumentException('valid category_id is required');
        }
        if (!is_int($priceCents) || $priceCents < 0) {
            throw new InvalidArgumentException('price_cents must be a non-negative integer');
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO menu_items (category_id, name, description, price_cents, sku, sort_order)
             VALUES (:category_id, :name, :description, :price_cents, :sku, :sort_order)'
        );
        $stmt->execute([
            'category_id' => $categoryId,
            'name' => $name,
            'description' => $input['description'] ?? null,
            'price_cents' => $priceCents,
            'sku' => $input['sku'] ?? null,
            'sort_order' => (int) ($input['sort_order'] ?? 0),
        ]);

        return $this->findItem((int) $this->pdo->lastInsertId());
    }

    public function updateItem(int $id, array $input): array
    {
        $item = $this->findItem($id);
        if ($item === null) {
            throw new RuntimeException('Menu item not found');
        }

        $name = isset($input['name']) ? trim((string) $input['name']) : $item['name'];
        if ($name === '') {
            throw new InvalidArgumentException('name cannot be empty');
        }

        $categoryId = (int) ($input['category_id'] ?? $item['category_id']);
        if ($this->findCategory($categoryId) === null) {
            throw new InvalidArgumentException('valid category_id is required');
        }

        $priceCents = $input['price_cents'] ?? $item['price_cents'];
        if (!is_int($priceCents) || $priceCents < 0) {
            throw new InvalidArgumentException('price_cents must be a non-negative integer');
        }

        $stmt = $this->pdo->prepare(
            'UPDATE menu_items SET
                category_id = :category_id,
                name = :name,
                description = :description,
                price_cents = :price_cents,
                sku = :sku,
                sort_order = :sort_order,
                is_active = :is_active,
                updated_at = datetime(\'now\')
             WHERE id = :id'
        );
        $stmt->execute([
            'category_id' => $categoryId,
            'name' => $name,
            'description' => $input['description'] ?? $item['description'],
            'price_cents' => $priceCents,
            'sku' => $input['sku'] ?? $item['sku'],
            'sort_order' => (int) ($input['sort_order'] ?? $item['sort_order']),
            'is_active' => isset($input['is_active']) ? (int) (bool) $input['is_active'] : (int) $item['is_active'],
            'id' => $id,
        ]);

        return $this->findItem($id);
    }

    public function deleteItem(int $id): void
    {
        try {
            $stmt = $this->pdo->prepare('DELETE FROM menu_items WHERE id = :id');
            $stmt->execute(['id' => $id]);
        } catch (PDOException $e) {
            throw new RuntimeException('Cannot delete menu item — it appears in past orders. Deactivate it instead.', 0, $e);
        }
    }

    public function findItem(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM menu_items WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }
}
