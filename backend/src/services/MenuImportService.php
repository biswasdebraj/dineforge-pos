<?php

declare(strict_types=1);

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Reader\Xlsx as XlsxReader;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx as XlsxWriter;

final class MenuImportService
{
    private const HEADERS = ['Category', 'Item Name', 'Price', 'Description', 'SKU'];

    public function __construct(private MenuService $menu)
    {
    }

    public function generateTemplate(): string
    {
        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle('Menu');
        $sheet->fromArray(self::HEADERS, null, 'A1');
        $sheet->fromArray(['Burgers', 'Classic Burger', 9.50, 'Beef patty, lettuce, tomato', 'BRG-001'], null, 'A2');
        foreach (['A', 'B', 'C', 'D', 'E'] as $col) {
            $sheet->getColumnDimension($col)->setAutoSize(true);
        }

        $tmpFile = tempnam(sys_get_temp_dir(), 'dineforge-menu-template-') . '.xlsx';
        (new XlsxWriter($spreadsheet))->save($tmpFile);
        $contents = file_get_contents($tmpFile);
        unlink($tmpFile);

        return $contents;
    }

    // Category and item name matching is case-insensitive: re-importing the
    // same file (e.g. after fixing a price) updates existing items in place
    // rather than creating duplicates, and reuses categories that already
    // exist rather than making "Burgers" and "burgers" two different ones.
    public function import(string $filePath): array
    {
        $reader = new XlsxReader();
        $spreadsheet = $reader->load($filePath);
        $rows = $spreadsheet->getActiveSheet()->toArray(null, true, true, false);

        $created = 0;
        $updated = 0;
        $errors = [];

        $categoryIdByName = [];
        foreach ($this->menu->listCategories() as $category) {
            $categoryIdByName[mb_strtolower(trim($category['name']))] = (int) $category['id'];
        }

        foreach ($rows as $index => $row) {
            $rowNum = $index + 1;
            if ($rowNum === 1) {
                continue; // header row
            }

            [$categoryName, $itemName, $price, $description, $sku] = array_pad($row, 5, null);
            $categoryName = trim((string) ($categoryName ?? ''));
            $itemName = trim((string) ($itemName ?? ''));

            if ($categoryName === '' && $itemName === '') {
                continue; // blank row
            }
            if ($categoryName === '') {
                $errors[] = "Row {$rowNum}: category is required";
                continue;
            }
            if ($itemName === '') {
                $errors[] = "Row {$rowNum}: item name is required";
                continue;
            }
            if (!is_numeric($price)) {
                $errors[] = "Row {$rowNum}: price must be a number";
                continue;
            }

            $priceCents = (int) round(((float) $price) * 100);
            if ($priceCents < 0) {
                $errors[] = "Row {$rowNum}: price cannot be negative";
                continue;
            }

            $categoryKey = mb_strtolower($categoryName);
            if (!isset($categoryIdByName[$categoryKey])) {
                $newCategory = $this->menu->createCategory(['name' => $categoryName]);
                $categoryIdByName[$categoryKey] = (int) $newCategory['id'];
            }
            $categoryId = $categoryIdByName[$categoryKey];

            $existing = null;
            foreach ($this->menu->listItems($categoryId) as $candidate) {
                if (mb_strtolower($candidate['name']) === mb_strtolower($itemName)) {
                    $existing = $candidate;
                    break;
                }
            }

            $payload = [
                'category_id' => $categoryId,
                'name' => $itemName,
                'price_cents' => $priceCents,
                'description' => $description !== null && trim((string) $description) !== '' ? trim((string) $description) : null,
                'sku' => $sku !== null && trim((string) $sku) !== '' ? trim((string) $sku) : null,
            ];

            if ($existing !== null) {
                $this->menu->updateItem((int) $existing['id'], $payload);
                $updated++;
            } else {
                $this->menu->createItem($payload);
                $created++;
            }
        }

        return ['created' => $created, 'updated' => $updated, 'errors' => $errors];
    }
}
