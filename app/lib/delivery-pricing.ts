export type DeliveryPriceCurrency = "EUR" | "MAD";

// Fixed business rate: 1.5 EUR/kg for parcels shipped from Belgium, 15 MAD/kg
// for parcels shipped from Morocco. Price is derived from weight and origin
// country, never entered manually, so every parcel is priced consistently
// and the revenue dashboard can trust priceAmount/priceCurrency as billing
// truth rather than a dispatcher's free-form guess.
export const DELIVERY_PRICE_RATE_EUR_PER_KG = 1.5;
export const DELIVERY_PRICE_RATE_MAD_PER_KG = 15;

export function deliveryPriceCurrencyForOriginCountry(originCountry: string | null | undefined): DeliveryPriceCurrency {
  return originCountry === "MA" ? "MAD" : "EUR";
}

export function deliveryPriceRatePerKg(currency: DeliveryPriceCurrency): number {
  return currency === "MAD" ? DELIVERY_PRICE_RATE_MAD_PER_KG : DELIVERY_PRICE_RATE_EUR_PER_KG;
}

export function computeDeliveryPrice(
  weightKg: number | null | undefined,
  originCountry: string | null | undefined,
): { priceAmount: number | null; priceCurrency: DeliveryPriceCurrency | null } {
  if (weightKg === null || weightKg === undefined || !(weightKg > 0)) return { priceAmount: null, priceCurrency: null };
  const priceCurrency = deliveryPriceCurrencyForOriginCountry(originCountry);
  const priceAmount = Math.round(weightKg * deliveryPriceRatePerKg(priceCurrency) * 100) / 100;
  return { priceAmount, priceCurrency };
}
