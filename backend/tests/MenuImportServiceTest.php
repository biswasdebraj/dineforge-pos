<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx as XlsxWriter;

final class MenuImportServiceTest extends TestCase
{
    private MenuService $menu;
    private MenuImportService $import;
    private array $tempFiles = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->menu = new MenuService($this->pdo);
        $this->import = new MenuImportService($this->menu);
    }

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $file) {
            if (file_exists($file)) {
                unlink($file);
            }
        }
        parent::tearDown();
    }

    private function buildXlsx(array $rows): string
    {
        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->fromArray(['Category', 'Item Name', 'Price', 'Description', 'SKU'], null, 'A1');
        $sheet->fromArray($rows, null, 'A2');

        $file = tempnam(sys_get_temp_dir(), 'dineforge-import-test-') . '.xlsx';
        $this->tempFiles[] = $file;
        (new XlsxWriter($spreadsheet))->save($file);
        return $file;
    }

    public function testGenerateTemplateProducesAValidXlsxFile(): void
    {
        $contents = $this->import->generateTemplate();

        $this->assertNotEmpty($contents);
        // .xlsx is a zip archive — every zip starts with this magic number.
        $this->assertSame("PK\x03\x04", substr($contents, 0, 4));
    }

    public function testImportCreatesNewCategoryAndItem(): void
    {
        $file = $this->buildXlsx([['Burgers', 'Classic Burger', 9.50, 'Beef patty', 'BRG-1']]);

        $result = $this->import->import($file);

        $this->assertSame(1, $result['created']);
        $this->assertSame(0, $result['updated']);
        $this->assertSame([], $result['errors']);

        $categories = $this->menu->listCategories();
        $this->assertCount(1, $categories);
        $this->assertSame('Burgers', $categories[0]['name']);

        $items = $this->menu->listItems((int) $categories[0]['id']);
        $this->assertCount(1, $items);
        $this->assertSame('Classic Burger', $items[0]['name']);
        $this->assertSame(950, $items[0]['price_cents']);
        $this->assertSame('BRG-1', $items[0]['sku']);
    }

    public function testReimportUpdatesExistingItemInsteadOfDuplicating(): void
    {
        $first = $this->buildXlsx([['Burgers', 'Classic Burger', 9.50, null, null]]);
        $this->import->import($first);

        $second = $this->buildXlsx([['Burgers', 'Classic Burger', 11.00, null, null]]);
        $result = $this->import->import($second);

        $this->assertSame(0, $result['created']);
        $this->assertSame(1, $result['updated']);

        $categories = $this->menu->listCategories();
        $this->assertCount(1, $categories); // not duplicated
        $items = $this->menu->listItems((int) $categories[0]['id']);
        $this->assertCount(1, $items); // not duplicated
        $this->assertSame(1100, $items[0]['price_cents']);
    }

    public function testCategoryMatchingIsCaseInsensitive(): void
    {
        $this->import->import($this->buildXlsx([['Burgers', 'Classic Burger', 9.50, null, null]]));
        $this->import->import($this->buildXlsx([['BURGERS', 'Cheeseburger', 10.50, null, null]]));

        $this->assertCount(1, $this->menu->listCategories());
    }

    public function testInvalidRowsAreCollectedAsErrorsWithoutAbortingTheRest(): void
    {
        $file = $this->buildXlsx([
            ['Burgers', 'Classic Burger', 9.50, null, null],
            ['Burgers', '', 5.00, null, null],       // missing item name
            ['Burgers', 'Bad Price Item', 'oops', null, null], // non-numeric price
            ['', 'No Category Item', 5.00, null, null],        // missing category
        ]);

        $result = $this->import->import($file);

        $this->assertSame(1, $result['created']);
        $this->assertCount(3, $result['errors']);
    }

    public function testBlankRowsAreSkippedSilently(): void
    {
        $file = $this->buildXlsx([
            ['Burgers', 'Classic Burger', 9.50, null, null],
            [null, null, null, null, null],
        ]);

        $result = $this->import->import($file);

        $this->assertSame(1, $result['created']);
        $this->assertSame([], $result['errors']);
    }
}
