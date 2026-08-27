// Prefix stamped on the customer name of deliveries created via the
// dispatcher's "Créer une livraison démo" quick-create button (see
// app/api/deliveries/demo/route.ts), so they're visually distinguishable
// from real customer data in the deliveries table and can be bulk-deleted
// later without any risk of touching a real delivery.
export const DEMO_DELIVERY_CUSTOMER_PREFIX = "[DEMO] ";
