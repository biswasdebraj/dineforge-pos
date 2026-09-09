<?php

declare(strict_types=1);

/**
 * Wraps a route handler so it only runs for a caller holding a valid
 * session in one of $roles. The session token travels in the
 * X-Session-Token header, set by the frontend after role login.
 */
function guarded(AuthService $auth, array $roles, callable $handler): callable
{
    return function (array $params) use ($auth, $roles, $handler) {
        $token = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? null;
        $role = $auth->resolveRole($token);

        if ($role === null) {
            json_error('Not authenticated', 401);
        }
        if (!in_array($role, $roles, true)) {
            json_error('Not authorized for this action', 403);
        }

        $handler($params);
    };
}
