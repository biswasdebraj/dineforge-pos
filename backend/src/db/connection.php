<?php

declare(strict_types=1);

require_once __DIR__ . '/migrate.php';
require_once __DIR__ . '/../support/paths.php';

function get_db_connection(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $dbPath = get_data_dir() . '/foodnest.sqlite';
        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA synchronous = NORMAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        run_migrations($pdo);
    }

    return $pdo;
}
