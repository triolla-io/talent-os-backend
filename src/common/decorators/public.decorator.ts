import { SetMetadata, CustomDecorator } from '@nestjs/common';

/**
 * Metadata key set by {@link Public}. A global/session guard can read it via
 * `Reflector` to skip authentication for the decorated route.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as intentionally public — i.e. reachable
 * without an authenticated session. Used on pre-auth flows (login, magic-link,
 * invitations), health checks, and signature-verified webhooks, all of which
 * cannot sit behind `SessionGuard`.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
