/**
 * fetch-with-retry.js
 *
 * Isomorphic exponential-backoff fetch wrapper. This is a straight port of the
 * `fetchWithRetry` helper that is copy-pasted identically into jrwll.html,
 * sb3.html, and bb.html today.
 *
 * IMPORTANT: this file is deliberately dependency-free and uses only globals
 * available in both Node 20+ (global `fetch`) and every modern browser, so it
 * can be imported unmodified from:
 *   - data-build/fetch-sleeper.js (Node build script, CommonJS-free ESM), and
 *   - src/scripts/sleeper-client.js (browser code, bundled later by esbuild).
 *
 * Do NOT add `fs`, `path`, `process`, or any other Node-only API to this file.
 */

/**
 * Fetch a URL as JSON, retrying with exponential backoff on network errors or
 * non-2xx responses.
 *
 * @param {string} url - URL to fetch.
 * @param {number} [retries=3] - Number of attempts before giving up and throwing.
 * @param {number} [delay=1000] - Initial delay in ms before the first retry; doubles after each failed attempt.
 * @returns {Promise<any>} Parsed JSON body.
 * @throws {Error} If all retry attempts are exhausted, or the response is never `ok`.
 *   The thrown error's message includes the URL and the last HTTP status seen,
 *   so build failures are easy to diagnose in CI logs.
 */
export async function fetchWithRetry(url, retries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} for ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-console
      console.warn(
        `[fetchWithRetry] Attempt ${i + 1}/${retries} failed for ${url}: ${error.message || error}.` +
          (i < retries - 1 ? ` Retrying in ${delay}ms...` : "")
      );
      if (i === retries - 1) {
        throw new Error(
          `[fetchWithRetry] Giving up on ${url} after ${retries} attempts. Last error: ${lastError.message || lastError}`
        );
      }
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
  // Unreachable, but keeps TypeScript/JSDoc consumers happy about return type.
  throw lastError;
}
