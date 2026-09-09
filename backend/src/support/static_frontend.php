<?php

declare(strict_types=1);

const STATIC_MIME_TYPES = [
    'html' => 'text/html; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'json' => 'application/json',
    'png' => 'image/png',
    'svg' => 'image/svg+xml',
    'ico' => 'image/x-icon',
];

/**
 * Serves the frontend SPA over HTTP so LAN/mobile devices — which load the
 * page via a real URL, not Electron's file:// — can reach it. The local
 * terminal doesn't use this at all (it loads via BrowserWindow.loadFile);
 * this exists purely for external devices scanning the QR code.
 *
 * DINEFORGE_FRONTEND_DIR is set by the Electron shell; falls back to the
 * repo-relative path for direct dev/CLI use of this backend.
 */
function serve_static_frontend(string $uri): void
{
    $frontendDir = getenv('DINEFORGE_FRONTEND_DIR');
    if ($frontendDir === false || $frontendDir === '') {
        $frontendDir = __DIR__ . '/../../../frontend/src';
    }

    $frontendReal = realpath($frontendDir);
    if ($frontendReal === false) {
        http_response_code(500);
        echo 'Frontend directory not found';
        return;
    }

    $relativePath = $uri === '/' ? '/index.html' : $uri;
    $filePath = realpath($frontendReal . $relativePath);

    // Reject missing files and any path-traversal attempt outside frontendDir.
    if ($filePath === false || strpos($filePath, $frontendReal) !== 0 || !is_file($filePath)) {
        http_response_code(404);
        echo 'Not found';
        return;
    }

    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    header('Content-Type: ' . (STATIC_MIME_TYPES[$ext] ?? 'application/octet-stream'));
    readfile($filePath);
}
