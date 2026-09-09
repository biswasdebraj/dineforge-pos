<?php

declare(strict_types=1);

/**
 * Where user data (the SQLite DB, backups) lives. The Electron shell sets
 * FOODNEST_DATA_DIR to its per-user app-data folder so an installed,
 * possibly read-only Program Files copy of backend/ never has to be
 * written to. Falls back to backend/data for direct dev/CLI/test use
 * (php -S backend/public without going through Electron at all).
 */
function get_data_dir(): string
{
    $dir = getenv('FOODNEST_DATA_DIR');
    if ($dir === false || $dir === '') {
        $dir = __DIR__ . '/../../data';
    }

    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }

    return $dir;
}
