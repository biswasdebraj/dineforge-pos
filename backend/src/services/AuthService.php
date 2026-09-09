<?php

declare(strict_types=1);

final class AuthService
{
    public const ROLES = ['waiter', 'kitchen', 'admin'];

    private const SESSION_HOURS = 12;

    public function __construct(private PDO $pdo)
    {
    }

    public function status(): array
    {
        $result = [];
        foreach (self::ROLES as $role) {
            $stmt = $this->pdo->prepare('SELECT 1 FROM role_pins WHERE role = :role');
            $stmt->execute(['role' => $role]);
            $result[$role] = $stmt->fetchColumn() !== false;
        }
        return $result;
    }

    public function setPin(string $role, ?string $pin): void
    {
        $this->assertValidRole($role);

        if ($pin === null || $pin === '') {
            $stmt = $this->pdo->prepare('DELETE FROM role_pins WHERE role = :role');
            $stmt->execute(['role' => $role]);
            return;
        }

        $hash = password_hash($pin, PASSWORD_DEFAULT);
        $stmt = $this->pdo->prepare(
            "INSERT INTO role_pins (role, pin_hash, updated_at) VALUES (:role, :hash, datetime('now'))
             ON CONFLICT(role) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at"
        );
        $stmt->execute(['role' => $role, 'hash' => $hash]);
    }

    /**
     * Logs in as $role. Succeeds (and issues a session) with any PIN,
     * including a blank one, if that role has no PIN configured yet —
     * mirrors the Phase 7 "optional, off by default" precedent so a fresh
     * install is never locked out. Returns null only when a PIN IS
     * configured and the supplied one doesn't match.
     */
    public function login(string $role, string $pin): ?string
    {
        $this->assertValidRole($role);

        $stmt = $this->pdo->prepare('SELECT pin_hash FROM role_pins WHERE role = :role');
        $stmt->execute(['role' => $role]);
        $hash = $stmt->fetchColumn();

        if ($hash !== false && !password_verify($pin, $hash)) {
            return null;
        }

        $token = bin2hex(random_bytes(32));
        $expiresAt = date(DATE_ATOM, time() + self::SESSION_HOURS * 3600);

        $stmt = $this->pdo->prepare('INSERT INTO sessions (token, role, expires_at) VALUES (:token, :role, :expires_at)');
        $stmt->execute(['token' => $token, 'role' => $role, 'expires_at' => $expiresAt]);

        return $token;
    }

    public function resolveRole(?string $token): ?string
    {
        if ($token === null || $token === '') {
            return null;
        }

        $stmt = $this->pdo->prepare('SELECT role, expires_at FROM sessions WHERE token = :token');
        $stmt->execute(['token' => $token]);
        $row = $stmt->fetch();

        if ($row === false) {
            return null;
        }

        if (strtotime($row['expires_at']) < time()) {
            $this->logout($token);
            return null;
        }

        return $row['role'];
    }

    public function logout(string $token): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE token = :token');
        $stmt->execute(['token' => $token]);
    }

    private function assertValidRole(string $role): void
    {
        if (!in_array($role, self::ROLES, true)) {
            throw new InvalidArgumentException('invalid role');
        }
    }
}
