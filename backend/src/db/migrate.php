<?php

declare(strict_types=1);

function run_migrations(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");

    $applied = $pdo->query('SELECT filename FROM _migrations')->fetchAll(PDO::FETCH_COLUMN);
    $appliedSet = array_flip($applied);

    $files = glob(__DIR__ . '/migrations/*.sql');
    sort($files);

    foreach ($files as $file) {
        $name = basename($file);
        if (isset($appliedSet[$name])) {
            continue;
        }

        $sql = file_get_contents($file);

        $pdo->beginTransaction();
        try {
            $pdo->exec($sql);
            $stmt = $pdo->prepare('INSERT INTO _migrations (filename) VALUES (:name)');
            $stmt->execute(['name' => $name]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw new RuntimeException("Migration failed: {$name} — {$e->getMessage()}", 0, $e);
        }
    }
}
