<?php

declare(strict_types=1);

final class SettingsServiceTest extends TestCase
{
    public function testUpdateAndGet(): void
    {
        $settings = new SettingsService($this->pdo);
        $settings->update(['restaurant_name' => 'Test Bistro', 'currency_symbol' => '€']);

        $all = $settings->all();

        $this->assertSame('Test Bistro', $all['restaurant_name']);
        $this->assertSame('€', $all['currency_symbol']);
    }

    public function testUpdateTaxAndSetDefault(): void
    {
        $settings = new SettingsService($this->pdo);
        $taxes = $settings->listTaxes();
        $defaultId = (int) $taxes[0]['id'];

        $updated = $settings->updateTax($defaultId, ['name' => 'Sales Tax', 'rate_percent' => 8.5, 'is_default' => true]);

        $this->assertSame('Sales Tax', $updated['name']);
        $this->assertSame(8.5, (float) $updated['rate_percent']);
        $this->assertSame(1, (int) $updated['is_default']);
    }
}
