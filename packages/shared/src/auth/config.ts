export interface AuthConfig {
    env: 'dev' | 'prod';
    projectId: string;
    apiKey: string;
    identityToolkitUrl: string;
    secureTokenUrl: string;
    firestoreUrl: string;
    frontendBaseUrl: string;
    source: string;
}

// Mutable by design: dev builds retarget projectId/apiKey/frontendBaseUrl at
// runtime to switch between prod and preprod (see ./devEnvSwitch). Consumers
// must therefore read `config.x` at call time and never cache a field at
// import time, or the switch will not reach them.
export const config: AuthConfig = {
    env: __EXT_ENV__,
    projectId: __FIREBASE_PROJECT_ID__,
    apiKey: __FIREBASE_API_KEY__,
    identityToolkitUrl: __IDENTITY_TOOLKIT_URL__,
    secureTokenUrl: __SECURE_TOKEN_URL__,
    firestoreUrl: __FIRESTORE_URL__,
    frontendBaseUrl: __FRONTEND_BASE_URL__,
    source: __EXT_SOURCE__,
};

export const isDev = config.env === 'dev';
