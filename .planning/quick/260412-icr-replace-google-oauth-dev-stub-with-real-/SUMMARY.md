# Quick Task 260412-icr: Replace Google OAuth Dev Stub with Real API When GOOGLE_CLIENT_ID Is Set

## What Changed

`fetchGoogleUserInfo` in `src/auth/auth.service.ts` was restructured to key off `GOOGLE_CLIENT_ID` presence rather than `NODE_ENV`.

**Before:** The method checked `isProd` (NODE_ENV === 'production') first, so any non-production environment always hit the dev stub — even if `GOOGLE_CLIENT_ID` was configured and a real token was being passed in.

**After:** The method now checks `clientId` (GOOGLE_CLIENT_ID) first:
1. If `GOOGLE_CLIENT_ID` is set — call the real Google UserInfo API, regardless of NODE_ENV.
2. If `GOOGLE_CLIENT_ID` is absent and isProd — throw UnauthorizedException (unchanged).
3. If `GOOGLE_CLIENT_ID` is absent and not production — use the dev stub (unchanged).

## Why

The previous logic made local development with a real Google OAuth client impossible. Developers who configured GOOGLE_CLIENT_ID in their .env were silently routed to the stub, causing confusing failures when testing against real Google tokens.

## Files Modified

- src/auth/auth.service.ts — restructured fetchGoogleUserInfo method

## Test Results

Auth test suites: 7 passed, 1 failed (pre-existing failures in invitation.service.spec.ts unrelated to this change — mock setup issues for tx.user.findFirst and redis.getdel).
