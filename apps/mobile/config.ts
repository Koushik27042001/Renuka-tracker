declare const RENUKA_RELEASE_API_URL: string;
declare const RENUKA_APP_VERSION: string;

const releaseApiUrl = typeof RENUKA_RELEASE_API_URL === 'string' ? RENUKA_RELEASE_API_URL : '';
export const appVersion = typeof RENUKA_APP_VERSION === 'string' ? RENUKA_APP_VERSION : '1.0.0';
export const apiUrl = releaseApiUrl || (__DEV__ ? 'http://localhost:3000' : '');
