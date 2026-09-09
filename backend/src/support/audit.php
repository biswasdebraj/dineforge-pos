<?php

declare(strict_types=1);

function log_audit(PDO $pdo, string $entityType, ?int $entityId, string $action, ?array $details = null): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO audit_log (entity_type, entity_id, action, details) VALUES (:entity_type, :entity_id, :action, :details)'
    );
    $stmt->execute([
        'entity_type' => $entityType,
        'entity_id' => $entityId,
        'action' => $action,
        'details' => $details !== null ? json_encode($details) : null,
    ]);
}
