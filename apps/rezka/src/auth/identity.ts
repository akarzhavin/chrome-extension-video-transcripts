export function getGoogleAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(chrome.runtime.lastError?.message ?? 'getAuthToken returned no token'));
                return;
            }
            resolve(typeof token === 'string' ? token : (token as { token: string }).token);
        });
    });
}

export function clearCachedGoogleTokens(): Promise<void> {
    return new Promise((resolve) => {
        chrome.identity.clearAllCachedAuthTokens(() => resolve());
    });
}
