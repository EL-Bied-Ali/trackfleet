// Pre-fills the SENDATRACK account ID and username on this device so
// forgetful users don't have to retype them every time -- these two fields
// are not secrets by themselves (no access without the password too), unlike
// the password itself, which is deliberately never touched here and is left
// to the browser's own password manager (see the autoComplete attributes on
// the login form in page.tsx).
const storageKey = "trackfleet-remembered-login";

export type RememberedLogin = { accountID: string; user: string };

export function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed.accountID !== "string" || typeof parsed.user !== "string") return null;
    return { accountID: parsed.accountID, user: parsed.user };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(login: RememberedLogin) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(login));
  } catch {
    // Best-effort only -- private browsing / storage quota must never block login.
  }
}

export function clearRememberedLogin() {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}
