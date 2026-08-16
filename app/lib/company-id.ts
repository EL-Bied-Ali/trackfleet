export async function companyIdForAccount(accountID: string) {
  const normalized = accountID.trim().toLowerCase();
  if (!normalized) throw new Error("missing_account_id");
  const bytes = new TextEncoder().encode(`sendatrack-account:${normalized}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
