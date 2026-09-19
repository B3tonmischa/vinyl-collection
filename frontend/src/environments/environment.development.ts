// Dev environment: points at the backend's default dev server. The backend
// already sets FRONTEND_ORIGIN=http://localhost:4200 for CORS with
// credentials, matching Angular's dev-server default port.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
};
