// A short, print-friendly identifier separate from the customer-facing
// trackingToken (see company-auth.ts's createTrackingToken): the QR label
// only ever needs to survive a company-scoped, authenticated lookup (the
// scan endpoint always requires a dispatcher/agency session), not stand on
// its own as a bearer secret the way the 24-char public tracking token
// does. Kept short so the printed QR stays small and the fallback Code128
// barcode stays narrow. Alphabet excludes visually ambiguous characters
// (0/O, 1/I/L) since this also gets read by eyes, not just cameras.
const PARCEL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PARCEL_CODE_LENGTH = 10;

export const PARCEL_CODE_PATTERN = new RegExp(`^[${PARCEL_CODE_ALPHABET}]{${PARCEL_CODE_LENGTH}}$`);

export function createParcelCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PARCEL_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += PARCEL_CODE_ALPHABET[byte % PARCEL_CODE_ALPHABET.length];
  return code;
}

export function isValidParcelCode(value: string): boolean {
  return PARCEL_CODE_PATTERN.test(value);
}

// The QR encodes a full deep link (opens the scan page directly to this
// parcel if scanned outside the app, e.g. with the phone's native camera)
// rather than the bare code -- see scan-url.ts's companion parse function.
export function parcelScanUrl(origin: string, parcelCode: string): string {
  return `${origin}/scan/${parcelCode}`;
}
