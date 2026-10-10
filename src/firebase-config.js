// Environment-only view of the Firebase setup. The SDK itself is loaded on demand (see loadFirebase).
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
export const configured = Object.values(firebaseConfig).every(Boolean);
export const loadFirebase = () => import('./firebase.js');
