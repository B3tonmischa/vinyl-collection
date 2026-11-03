// Phone-on-the-LAN dev environment (`npm run start:lan`). The page is
// served over HTTPS from this machine's LAN IP — getUserMedia needs a
// secure context — so the API can't be http://localhost:3000: that's the
// phone itself, and it would be mixed content anyway. Instead the dev
// server proxies same-origin /api to the backend (proxy.lan.json), which
// also keeps the auth cookie first-party.
export const environment = {
  production: false,
  apiUrl: '/api',
};
