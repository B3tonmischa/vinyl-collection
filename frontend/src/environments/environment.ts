// Production environment. The app is deployed under a subpath —
// https://michabrenner.com/vinyl-collection — rather than at a domain's
// root, so apiUrl has to include that same prefix: a bare '/api' would
// resolve against the site root, not wherever the app itself lives.
// The frontend build's own asset/router base path is set separately, via
// `--base-href /vinyl-collection/` in frontend/Dockerfile (Angular CLI
// build option, not something configured here).
export const environment = {
  production: true,
  apiUrl: '/vinyl-collection/api',
};
