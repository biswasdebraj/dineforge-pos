<?php

declare(strict_types=1);

final class AuthServiceTest extends TestCase
{
    public function testStatusAllFalseByDefault(): void
    {
        $auth = new AuthService($this->pdo);
        $this->assertSame(['waiter' => false, 'kitchen' => false, 'admin' => false], $auth->status());
    }

    public function testLoginSucceedsWithoutPinWhenNoneConfigured(): void
    {
        $auth = new AuthService($this->pdo);
        $token = $auth->login('waiter', '');
        $this->assertNotNull($token);
        $this->assertSame('waiter', $auth->resolveRole($token));
    }

    public function testSetPinThenLoginRequiresCorrectPin(): void
    {
        $auth = new AuthService($this->pdo);
        $auth->setPin('admin', '1234');

        $this->assertNull($auth->login('admin', '9999'));
        $this->assertNull($auth->login('admin', ''));

        $token = $auth->login('admin', '1234');
        $this->assertNotNull($token);
        $this->assertSame('admin', $auth->resolveRole($token));
    }

    public function testRemovingPinReopensRole(): void
    {
        $auth = new AuthService($this->pdo);
        $auth->setPin('kitchen', '5555');
        $this->assertNull($auth->login('kitchen', 'wrong'));

        $auth->setPin('kitchen', null);
        $this->assertNotNull($auth->login('kitchen', ''));
    }

    public function testResolveRoleRejectsUnknownToken(): void
    {
        $auth = new AuthService($this->pdo);
        $this->assertNull($auth->resolveRole('not-a-real-token'));
        $this->assertNull($auth->resolveRole(null));
    }

    public function testLogoutInvalidatesSession(): void
    {
        $auth = new AuthService($this->pdo);
        $token = $auth->login('waiter', '');
        $this->assertSame('waiter', $auth->resolveRole($token));

        $auth->logout($token);
        $this->assertNull($auth->resolveRole($token));
    }

    public function testExpiredSessionIsRejected(): void
    {
        $auth = new AuthService($this->pdo);
        $token = $auth->login('waiter', '');

        $this->pdo->prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token = :token")
            ->execute(['token' => $token]);

        $this->assertNull($auth->resolveRole($token));

        // Expired session should also have been cleaned up, not just rejected.
        $count = (int) $this->pdo->query('SELECT COUNT(*) FROM sessions')->fetchColumn();
        $this->assertSame(0, $count);
    }

    public function testInvalidRoleRejected(): void
    {
        $auth = new AuthService($this->pdo);
        $this->expectException(InvalidArgumentException::class);
        $auth->login('manager', '');
    }
}
