<?php

declare(strict_types=1);

final class MenuServiceTest extends TestCase
{
    public function testCreateAndListCategories(): void
    {
        $menu = new MenuService($this->pdo);
        $menu->createCategory(['name' => 'Burgers', 'sort_order' => 2]);
        $menu->createCategory(['name' => 'Drinks', 'sort_order' => 1]);

        $categories = $menu->listCategories();

        $this->assertCount(2, $categories);
        // Ordered by sort_order, so Drinks (1) comes before Burgers (2).
        $this->assertSame('Drinks', $categories[0]['name']);
        $this->assertSame('Burgers', $categories[1]['name']);
    }

    public function testCreateItemRequiresValidCategory(): void
    {
        $menu = new MenuService($this->pdo);

        $this->expectException(InvalidArgumentException::class);
        $menu->createItem(['category_id' => 999, 'name' => 'Ghost Item', 'price_cents' => 500]);
    }

    public function testUpdateItemPrice(): void
    {
        $menu = new MenuService($this->pdo);
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id'], 'Burger', 950);

        $updated = $menu->updateItem((int) $item['id'], ['price_cents' => 1200]);

        $this->assertSame(1200, $updated['price_cents']);
    }

    public function testDeleteCategoryStillInUseFails(): void
    {
        $menu = new MenuService($this->pdo);
        $cat = $this->makeCategory($menu);
        $this->makeItem($menu, (int) $cat['id']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/still has menu items/');
        $menu->deleteCategory((int) $cat['id']);
    }

    public function testListItemsFiltersBySku(): void
    {
        $menu = new MenuService($this->pdo);
        $cat = $this->makeCategory($menu);
        $menu->createItem(['category_id' => $cat['id'], 'name' => 'Cola', 'price_cents' => 300, 'sku' => 'ABC123']);
        $menu->createItem(['category_id' => $cat['id'], 'name' => 'Fries', 'price_cents' => 400]);

        $matches = $menu->listItems(null, false, 'ABC123');

        $this->assertCount(1, $matches);
        $this->assertSame('Cola', $matches[0]['name']);
    }
}
