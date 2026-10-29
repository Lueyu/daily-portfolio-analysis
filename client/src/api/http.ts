/**
 * @file api/http.ts
 * @description First-party HTTP client for the Squabble backend.
 *
 * An axios instance with Bearer-token injection (localStorage-backed session)
 * and a 401 interceptor that clears the session and sends the user to the
 * login page. Requests to /api/auth/* are exempt from the redirect so a
 * failed login attempt doesn't bounce.
 *
 * Drop-in replacement for the retired platform `axiosForBackend`: call it
 * with `{ url, method, data }` and read `response.data`.
 */
import axios, { type AxiosInstance } from 'axios';

/** localStorage keys for the JWT session. */
export const ACCESS_TOKEN_KEY = 'sq-at';
export const REFRESH_TOKEN_KEY = 'sq-rt';

/** Token storage helpers shared with the auth pages. */
export const tokenStore = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  save(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

/** Whether a session exists (token presence only; validity is server-side). */
export function hasSession(): boolean {
  return tokenStore.getAccessToken() !== null;
}

const http: AxiosInstance = axios.create({
  baseURL: '',
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? '';
    if (status === 401 && !url.includes('/api/auth/')) {
      tokenStore.clear();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);

export default http;
