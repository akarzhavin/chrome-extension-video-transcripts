// Define Vite build-time globals so background/auth modules can be imported in tests.
(global as any).__EXT_ENV__ = 'dev';
(global as any).__FIREBASE_PROJECT_ID__ = 'demo-lingogram';
(global as any).__FIREBASE_API_KEY__ = 'demo';
(global as any).__IDENTITY_TOOLKIT_URL__ = 'http://localhost:9099/identitytoolkit.googleapis.com';
(global as any).__SECURE_TOKEN_URL__ = 'http://localhost:9099/securetoken.googleapis.com';
(global as any).__FIRESTORE_URL__ = 'http://localhost:8080';
(global as any).__FRONTEND_BASE_URL__ = 'http://localhost:5173';
