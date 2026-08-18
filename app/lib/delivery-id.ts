const DELIVERY_ID_PREFIX = "TF-";
const DELIVERY_ID_BYTES = 8;

function randomHex(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function createDeliveryId() {
  return `${DELIVERY_ID_PREFIX}${randomHex(DELIVERY_ID_BYTES)}`;
}

export function deliveryIdIsValid(value: string) {
  return /^TF-[A-F0-9]{16}$/.test(value);
}
