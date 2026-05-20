export interface AuthConfig {
    env: 'dev' | 'prod';
    projectId: string;
    apiKey: string;
    identityToolkitUrl: string;
    secureTokenUrl: string;
    firestoreUrl: string;
}

export const config: AuthConfig = {
    env: __EXT_ENV__,
    projectId: __FIREBASE_PROJECT_ID__,
    apiKey: __FIREBASE_API_KEY__,
    identityToolkitUrl: __IDENTITY_TOOLKIT_URL__,
    secureTokenUrl: __SECURE_TOKEN_URL__,
    firestoreUrl: __FIRESTORE_URL__,
};

export const isDev = config.env === 'dev';
