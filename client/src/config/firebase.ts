import { initializeApp, FirebaseApp } from 'firebase/app'
import { getAnalytics, Analytics, isSupported } from 'firebase/analytics'
import { getAuth, Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// 1. Strict Validation Helper
const requiredFirebaseEnv = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};

const missingFirebaseEnv = Object.entries(requiredFirebaseEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);

const isConfigComplete = missingFirebaseEnv.length === 0;

// 2. Initialize App with a fallback to avoid "undefined" errors in other components
let app: FirebaseApp;
let auth: Auth;
let analytics: Analytics | null = null;

if (isConfigComplete) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  // 3. Conditional Analytics (isSupported handles SSR and AdBlockers)
  if (typeof window !== 'undefined') {
    isSupported().then((supported) => {
      if (supported && firebaseConfig.measurementId) {
        analytics = getAnalytics(app);
      }
    });
  }
} else {
  // Log missing keys for debugging Clovia on Render
  console.error(
    `Firebase Configuration is missing: ${missingFirebaseEnv.join(', ')}. Check environment variables.`
  );
  // Provide dummy initializations if needed to prevent "auth is undefined" crashes
  app = initializeApp({ apiKey: "dummy", projectId: "dummy", appId: "dummy" }); 
  auth = getAuth(app);
}

export { app, analytics, auth };
