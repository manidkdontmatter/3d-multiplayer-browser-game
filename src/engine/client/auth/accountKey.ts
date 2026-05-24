/**
 * Purpose: This file defines the "access key" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
const ACCOUNT_KEY_LENGTH = 12;
const ACCOUNT_KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ACCOUNT_KEY_FRAGMENT_PARAM = "accountKey";
const ACCOUNT_KEY_SESSION_PREFIX = "account_key_session:";
const ACCOUNT_KEY_BACKUP_PREFIX = "account_key_backup:";

export function resolveAccountKey(serverUrl: string): {
  key: string;
  source: "fragment" | "storage" | "none";
} {
  const fragmentKey = readAccountKeyFromFragment();
  if (isValidAccountKey(fragmentKey)) {
    storeAccountKey(serverUrl, fragmentKey);
    return { key: fragmentKey, source: "fragment" };
  }

  const stored = readStoredAccountKey(serverUrl);
  if (isValidAccountKey(stored)) {
    return { key: stored, source: "storage" };
  }
  return { key: "", source: "none" };
}

export function ensureAccountKey(serverUrl: string): {
  key: string;
  source: "fragment" | "storage" | "generated";
} {
  const resolved = resolveAccountKey(serverUrl);
  if (resolved.source === "fragment") {
    return { key: resolved.key, source: resolved.source };
  }
  if (resolved.source === "storage") {
    writeAccountKeyToFragment(resolved.key);
    storeAccountKey(serverUrl, resolved.key);
    return { key: resolved.key, source: resolved.source };
  }
  const generated = generateAccountKey();
  writeAccountKeyToFragment(generated);
  storeAccountKey(serverUrl, generated);
  return { key: generated, source: "generated" };
}

export function readAccountKeyFromFragment(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) {
    return null;
  }
  const params = new URLSearchParams(hash);
  const key = params.get(ACCOUNT_KEY_FRAGMENT_PARAM);
  return key && key.length > 0 ? key : null;
}

export function writeAccountKeyToFragment(accountKey: string): void {
  const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");
  params.set(ACCOUNT_KEY_FRAGMENT_PARAM, accountKey);
  window.location.hash = params.toString();
}

export function readStoredAccountKey(serverUrl: string): string | null {
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

export function storeAccountKey(serverUrl: string, accountKey: string): void {
  try {
    window.sessionStorage.setItem(sessionStorageKey(serverUrl), accountKey);
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }
  try {
    window.localStorage.setItem(backupStorageKey(serverUrl), accountKey);
  } catch {
    // Ignore storage failures (privacy mode, quota, etc).
  }
}

export function buildLoginLink(serverUrl: string, accountKey: string): string {
  const url = new URL(window.location.href);
  if (serverUrl && serverUrl !== "ws://localhost:9001") {
    url.searchParams.set("server", serverUrl);
  }
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  hashParams.set(ACCOUNT_KEY_FRAGMENT_PARAM, accountKey);
  url.hash = hashParams.toString();
  return url.toString();
}

export function isValidAccountKey(value: string | null | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return /^[A-Za-z0-9]{10,30}$/.test(value);
}

export function generateAccountKey(): string {
  const randomValues = new Uint32Array(ACCOUNT_KEY_LENGTH);
  window.crypto.getRandomValues(randomValues);
  let output = "";
  for (let i = 0; i < ACCOUNT_KEY_LENGTH; i += 1) {
    const randomValue = randomValues[i] ?? 0;
    output += ACCOUNT_KEY_ALPHABET[randomValue % ACCOUNT_KEY_ALPHABET.length];
  }
  return output;
}

function sessionStorageKey(serverUrl: string): string {
  return `${ACCOUNT_KEY_SESSION_PREFIX}${serverUrl}`;
}

function backupStorageKey(serverUrl: string): string {
  return `${ACCOUNT_KEY_BACKUP_PREFIX}${serverUrl}`;
}
