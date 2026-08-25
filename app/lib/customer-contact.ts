export function normalizeCustomerPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const international = trimmed.startsWith("+")
    ? trimmed.slice(1)
    : trimmed.startsWith("00")
      ? trimmed.slice(2)
      : trimmed;
  const digits = international.replace(/\D/g, "");

  // WhatsApp Cloud API expects an international recipient number without the
  // leading '+'. TrackFleet deliberately does not guess a country code from a
  // local number such as 06… or 0470… because the delivery can cross countries.
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same optional-field contract as normalizeCustomerPhone above: empty input
// returns "" (an omitted email is valid -- the field isn't required),
// malformed non-empty input returns null (so callers validating a form
// submission can reject it the same way they already do for an invalid
// phone number), and otherwise the normalized address is returned.
// Deliberately permissive (not a full RFC 5322 validator) -- the email
// provider itself rejects anything it can't actually deliver to at send
// time, so this only needs to catch obviously-wrong input at intake.
export function normalizeCustomerEmail(value: string | null | undefined) {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.length > 254 || !emailPattern.test(trimmed)) return null;
  return trimmed;
}
