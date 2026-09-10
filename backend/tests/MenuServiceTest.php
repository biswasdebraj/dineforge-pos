<?php

declare(strict_types=1);

final class MenuServiceTest extends TestCase
{
    private array $tempDirs = [];
    private array $tempFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $file) {
            if (file_exists($file)) {
                unlink($file);
            }
        }
        foreach ($this->tempDirs as $dir) {
            if (is_dir($dir)) {
                foreach (glob($dir . '/*') as $leftover) {
                    unlink($leftover);
                }
                rmdir($dir);
            }
        }
        parent::tearDown();
    }

    private function makeMenuWithImages(): MenuService
    {
        $dir = sys_get_temp_dir() . '/dineforge-menu-images-test-' . uniqid();
        $this->tempDirs[] = $dir;
        return new MenuService($this->pdo, $dir);
    }

    private function makeFakeImage(string $ext = 'jpg'): string
    {
        $file = tempnam(sys_get_temp_dir(), 'dineforge-fake-image-') . '.' . $ext;
        file_put_contents($file, 'fake image bytes');
        $this->tempFiles[] = $file;
        return $file;
    }

    public function testSetItemImageStoresFileAndPath(): void
    {
        $menu = $this->makeMenuWithImages();
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id']);
        $source = $this->makeFakeImage('png');

        $updated = $menu->setItemImage((int) $item['id'], $source, 'photo.png');

        $this->assertNotEmpty($updated['image_path']);
        $this->assertStringEndsWith('.png', $updated['image_path']);
        $this->assertFileExists($menu->getImagesDir() . '/' . $updated['image_path']);
    }

    public function testSetItemImageRejectsDisallowedExtension(): void
    {
        $menu = $this->makeMenuWithImages();
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id']);
        $source = $this->makeFakeImage('gif');

        $this->expectException(InvalidArgumentException::class);
        $menu->setItemImage((int) $item['id'], $source, 'photo.gif');
    }

    public function testReplacingImageDeletesThePreviousFile(): void
    {
        $menu = $this->makeMenuWithImages();
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id']);

        $first = $menu->setItemImage((int) $item['id'], $this->makeFakeImage('jpg'), 'a.jpg');
        $firstPath = $menu->getImagesDir() . '/' . $first['image_path'];
        $this->assertFileExists($firstPath);

        $second = $menu->setItemImage((int) $item['id'], $this->makeFakeImage('png'), 'b.png');

        $this->assertFileDoesNotExist($firstPath);
        $this->assertFileExists($menu->getImagesDir() . '/' . $second['image_path']);
    }

    public function testRemoveItemImageDeletesFileAndClearsPath(): void
    {
        $menu = $this->makeMenuWithImages();
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id']);
        $set = $menu->setItemImage((int) $item['id'], $this->makeFakeImage(), 'a.jpg');
        $imagePath = $menu->getImagesDir() . '/' . $set['image_path'];

        $result = $menu->removeItemImage((int) $item['id']);

        $this->assertNull($result['image_path']);
        $this->assertFileDoesNotExist($imagePath);
    }

    public function testDeletingItemCleansUpItsImageFile(): void
    {
        $menu = $this->makeMenuWithImages();
        $cat = $this->makeCategory($menu);
        $item = $this->makeItem($menu, (int) $cat['id']);
        $set = $menu->setItemImage((int) $item['id'], $this->makeFakeImage(), 'a.jpg');
        $imagePath = $menu->getImagesDir() . '/' . $set['image_path'];

        $menu->deleteItem((int) $item['id']);

        $this->assertFileDoesNotExist($imagePath);
    }

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
