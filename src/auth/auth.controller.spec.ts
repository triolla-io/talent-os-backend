describe('AuthController', () => {
  it.todo('GET /auth/me returns 401 when no session cookie');
  it.todo('GET /auth/me returns user data when session valid');
  it.todo('POST /auth/google/verify creates org+user on first sign-up (D-21)');
  it.todo('POST /auth/google/verify returns 409 EMAIL_EXISTS when auth_provider mismatch (D-22)');
  it.todo('POST /auth/logout clears talent_os_session cookie');
  it.todo('POST /auth/onboarding returns 409 when onboardingCompletedAt already set (D-14)');
  it.todo('POST /auth/magic-link always returns 200 (no email enumeration)');
  it.todo('GET /auth/magic-link/verify returns 404 for unknown token');
  it.todo('GET /auth/magic-link/verify returns 410 for expired token');
  it.todo('GET /auth/magic-link/verify sets session cookie and redirects on valid token');
  it.todo('GET /auth/invite/:token returns 404 for unknown token');
  it.todo('GET /auth/invite/:token returns 409 INVITE_USED for accepted token');
  it.todo('GET /auth/invite/:token returns 410 INVITE_EXPIRED for expired token');
  it.todo('POST /auth/invite/:token/accept creates user and sets session cookie');
});
