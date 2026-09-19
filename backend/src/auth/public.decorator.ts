import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route (or a whole controller) as reachable without a session cookie.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
