import { Logger } from '@nestjs/common';

// The values .env.example / .env.docker.example ship with. Starting with
// one of these still in place would mean a session secret (or an admin
// password hash) that anyone can read in the public repository.
const PLACEHOLDERS = new Set([
  'replace-with-a-long-random-string',
  'replace-with-bcrypt-hash',
]);

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Checks the auth settings once, at startup, and refuses to boot without
 * them. Without this a missing JWT_SECRET only surfaced as a failed login
 * much later, and a placeholder one was accepted silently.
 *
 * Returns the validated values so callers don't read process.env again.
 */
export function requireAuthEnv(env: NodeJS.ProcessEnv = process.env): {
  jwtSecret: string;
  adminUsername: string;
  adminPasswordHash: string;
} {
  const problems: string[] = [];

  const jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret || PLACEHOLDERS.has(jwtSecret)) {
    problems.push('JWT_SECRET must be set to a long random string');
  }

  const adminUsername = env.ADMIN_USERNAME ?? '';
  if (!adminUsername) {
    problems.push('ADMIN_USERNAME must be set');
  }

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH ?? '';
  if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(adminPasswordHash)) {
    problems.push(
      'ADMIN_PASSWORD_HASH must be a bcrypt hash (generate one with `npm run hash:password`)',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid backend configuration:\n- ${problems.join('\n- ')}`);
  }

  // Short but real secrets keep working — existing deployments shouldn't
  // stop booting over this — but it's worth saying so.
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    new Logger('Config').warn(
      `JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters; consider a longer one.`,
    );
  }

  return { jwtSecret, adminUsername, adminPasswordHash };
}
