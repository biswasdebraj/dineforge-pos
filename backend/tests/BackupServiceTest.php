<?php

declare(strict_types=1);

final class BackupServiceTest extends TestCase
{
    private string $backupDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->backupDir = sys_get_temp_dir() . '/foodnest_test_backups_' . uniqid();
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        foreach (glob($this->backupDir . '/*') ?: [] as $file) {
            unlink($file);
        }
        if (is_dir($this->backupDir)) {
            rmdir($this->backupDir);
        }
    }

    public function testCreateProducesValidSqliteFile(): void
    {
        $settings = new SettingsService($this->pdo);
        $settings->update(['restaurant_name' => 'Backup Test']);

        $backups = new BackupService($this->pdo, $this->backupDir);
        $result = $backups->create('manual');

        $path = $this->backupDir . '/' . $result['filename'];
        $this->assertFileExists($path);

        $backupPdo = new PDO('sqlite:' . $path);
        $name = $backupPdo->query("SELECT value FROM settings WHERE key = 'restaurant_name'")->fetchColumn();
        $this->assertSame('Backup Test', $name);
    }

    public function testListReturnsNewestFirst(): void
    {
        $backups = new BackupService($this->pdo, $this->backupDir);
        $backups->create('manual');
        sleep(1); // filename includes seconds; ensure distinct names
        $backups->create('shift-close');

        $list = $backups->list();

        $this->assertCount(2, $list);
        $this->assertStringContainsString('shift-close', $list[0]['filename']);
    }

    public function testRetentionKeepsOnlyFourteen(): void
    {
        $backups = new BackupService($this->pdo, $this->backupDir);

        // Fabricate 16 pre-existing backup files directly (with distinct
        // mtimes) rather than actually creating 16 real backups, so the
        // test doesn't need 16 real seconds to pass for distinct filenames.
        mkdir($this->backupDir, 0777, true);
        for ($i = 0; $i < 16; $i++) {
            $path = $this->backupDir . sprintf('/foodnest-fake-%02d.sqlite', $i);
            touch($path, time() - (16 - $i));
        }

        // One real create() should now enforce retention against the 16
        // pre-existing files plus itself (17 total) -> 14 remain.
        $backups->create('manual');

        $remaining = glob($this->backupDir . '/*.sqlite') ?: [];
        $this->assertCount(14, $remaining);
    }
}
