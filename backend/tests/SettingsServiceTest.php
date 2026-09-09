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

    public function testNoAdminPinByDefault(): void
    {
        $settings = new SettingsService($this->pdo);

        $this->assertFalse($settings->hasAdminPin());
        $this->assertTrue($settings->verifyAdminPin('anything')); // open when unset
    }

    public function testSetVerifyAndRemoveAdminPin(): void
    {
        $settings = new SettingsService($this->pdo);
        $settings->setAdminPin('1234');

        $this->assertTrue($settings->hasAdminPin());
        $this->assertTrue($settings->verifyAdminPin('1234'));
        $this->assertFalse($settings->verifyAdminPin('9999'));

        $settings->setAdminPin(null);
        $this->assertFalse($settings->hasAdminPin());
        $this->assertTrue($settings->verifyAdminPin('anything'));
    }

    public function testAdminPinHashNeverExposedViaAll(): void
    {
        $settings = new SettingsService($this->pdo);
        $settings->setAdminPin('1234');

        $all = $settings->all();

        $this->assertArrayNotHasKey('admin_pin_hash', $all);
    }

    public function testUpdateCannotOverwriteAdminPinHash(): void
    {
        $settings = new SettingsService($this->pdo);
        $settings->setAdminPin('1234');

        $settings->update(['admin_pin_hash' => 'not-a-real-hash']);

        $this->assertTrue($settings->verifyAdminPin('1234')); // unchanged
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
