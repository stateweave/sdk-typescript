import { afterEach, beforeEach, vi } from 'vitest';

const nativeFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv('TYPESAFE_API_KEY', 'unit-test-only-not-a-credential');
  vi.stubGlobal('fetch', (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, { ...options, redirect: 'error' });
    return Promise.reject(new Error('Unit tests forbid unmocked external network requests.'));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
