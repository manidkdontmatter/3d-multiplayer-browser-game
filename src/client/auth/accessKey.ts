const ACCESS_KEY_LENGTH = 12;
const ACCESS_KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ACCESS_KEY_FRAGMENT_PARAM = "k";
const ACCESS_KEY_SESSION_PREFIX = "vibe_access_key_session:";
const ACCESS_KEY_BACKUP_PREFIX = "vibe_access_key_backup:";

export function resolveAccessKey(serverUrl: string): {
  key: string;
  source: "fragment" | "storage" | "none";
} {
  const fragmentKey = readAccessKeyFromFragment();
  if (isValidAccessKey(fragmentKey)) {
    storeAccessKey(serverUrl, fragmentKey);
    return { key: fragmentKey, source: "fragment" };
  }

  const stored = readStoredAccessKey(serverUrl);
  if (isValidAccessKey(stored)) {
    return { key: stored, source: "storage" };
  }
  return { key: "", source: "none" };
}

export function readAccessKeyFromFragment(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return null;
  }
  const params = new URLSearchParams(hash);
  const key = params.get(ACCESS_KEY_FRAGMENT_PARAM);
  return key && key.length > 0 ? key : null;
}

export function writeAccessKeyToFragment(accessKey: string): void {
  const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");
  params.set(ACCESS_KEY_FRAGMENT_PARAM, accessKey);
  window.location.hash = params.toString();
}

export function readStoredAccessKey(serverUrl: string): string | null {
  try {
    const sessionKey = window.sessionStorage.getItem(sessionStorageKey(serverUrl));
    if (sessionKey && sessionKey.length > 0) {
      return sessionKey;
    }
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }

  try {
    const backupKey = window.localStorage.getItem(backupStorageKey(serverUrl));
    if (backupKey && backupKey.length > 0) {
      return backupKey;
    }
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }

  return null;
}

export function storeAccessKey(serverUrl: string, accessKey: string): void {
  try {
    window.sessionStorage.setItem(sessionStorageKey(serverUrl), accessKey);
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }
  try {
    window.localStorage.setItem(backupStorageKey(serverUrl), accessKey);
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }
}

export function buildLoginLink(serverUrl: string, accessKey: string): string {
  const url = new URL(window.location.href);
  if (serverUrl && serverUrl !== "ws://localhost:9001") {
    url.searchParams.set("server", serverUrl);
  }
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  hashParams.set(ACCESS_KEY_FRAGMENT_PARAM, accessKey);
  url.hash = hashParams.toString();
  return url.toString();
}

export function isValidAccessKey(value: string | null | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return /^[A-Za-z0-9]{12}$/.test(value);
}

export function generateAccessKey(): string {
  const randomValues = new Uint32Array(ACCESS_KEY_LENGTH);
  window.crypto.getRandomValues(randomValues);
  let output = "";
  for (let i = 0; i < ACCESS_KEY_LENGTH; i += 1) {
    const randomValue = randomValues[i] ?? 0;
    output += ACCESS_KEY_ALPHABET[randomValue % ACCESS_KEY_ALPHABET.length];
  }
  return output;
}

function sessionStorageKey(serverUrl: string): string {
  return `${ACCESS_KEY_SESSION_PREFIX}${serverUrl}`;
}

function backupStorageKey(serverUrl: string): string {
  return `${ACCESS_KEY_BACKUP_PREFIX}${serverUrl}`;
}
