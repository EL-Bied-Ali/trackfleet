function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return null;
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function decodeSessionEncryptionKey(value: string | null | undefined) {
  const encoded = value?.trim();
  if (!encoded) return null;
  const raw = decodeBase64(encoded);
  return raw?.byteLength === 32 ? raw : null;
}

export function sessionEncryptionKeyConfigured(value: string | null | undefined) {
  return decodeSessionEncryptionKey(value) !== null;
}
