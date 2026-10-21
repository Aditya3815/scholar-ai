/** Errors a browser throws that say nothing about our code: a lost connection, a cancelled request, a browser extension, a harmless layout notice. */
const NOISE = [
  /ResizeObserver loop/i,
  /Failed to fetch|NetworkError|Load failed|network request failed|Network connection was lost/i,
  /AbortError|The operation was aborted|The user aborted|signal is aborted/i,
  /Script error\.?$/i,
  /Non-Error promise rejection/i,
];

export function isNoise(type: string, message: string, stack: string): boolean {
  return NOISE.some((re) => re.test(message) || re.test(type)) || /(?:chrome|moz|safari-web)-extension:\/\//.test(stack);
}
