<?php

declare(strict_types=1);

final class BackupService
{
    private const RETAIN_COUNT = 14;

    private string $backupDir;

    public function __construct(private PDO $pdo)
    {
        $this->backupDir = __DIR__ . '/../../data/backups';
    }

    public function create(string $reason = 'manual'): array
    {
        if (!is_dir($this->backupDir)) {
            mkdir($this->backupDir, 0777, true);
        }

        $filename = sprintf('foodnest-%s-%s.sqlite', date('Ymd-His'), $reason);
        $path = $this->backupDir . '/' . $filename;

        // VACUUM INTO takes a consistent snapshot even while WAL is active,
        // unlike copying the .sqlite file directly which can catch it
        // mid-write or miss data still sitting in the -wal file.
        $escaped = str_replace("'", "''", $path);
        $this->pdo->exec("VACUUM INTO '{$escaped}'");

        $this->enforceRetention();

        return [
            'filename' => $filename,
            'size_bytes' => filesize($path),
            'created_at' => date(DATE_ATOM),
        ];
    }

    public function list(): array
    {
        if (!is_dir($this->backupDir)) {
            return [];
        }

        $files = glob($this->backupDir . '/*.sqlite') ?: [];
        $backups = array_map(function (string $path) {
            return [
                'filename' => basename($path),
                'size_bytes' => filesize($path),
                'created_at' => date(DATE_ATOM, filemtime($path)),
            ];
        }, $files);

        usort($backups, fn ($a, $b) => strcmp($b['filename'], $a['filename']));

        return $backups;
    }

    private function enforceRetention(): void
    {
        $files = glob($this->backupDir . '/*.sqlite') ?: [];
        if (count($files) <= self::RETAIN_COUNT) {
            return;
        }

        usort($files, fn ($a, $b) => filemtime($a) <=> filemtime($b));
        $toDelete = array_slice($files, 0, count($files) - self::RETAIN_COUNT);
        foreach ($toDelete as $file) {
            unlink($file);
        }
    }
}
