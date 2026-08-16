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
