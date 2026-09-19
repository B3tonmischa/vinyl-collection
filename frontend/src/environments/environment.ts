// Production environment. Placeholder — the real prod value depends on the
// self-hosting setup (Docker Compose + Caddy), which is deferred past v1.
// Likely a relative '/api' path once Caddy fronts both frontend and backend
// on one origin, so requests don't need an absolute host baked in.
export const environment = {
  production: true,
  apiUrl: '/api',
};
