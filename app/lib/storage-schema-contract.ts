export const REQUIRED_POSTGRES_TABLES = [
  "admin_audit_log",
  "automation_runtime_state",
  "companies",
  "deliveries",
  "delivery_eta_observations",
  "delivery_events",
  "delivery_notifications",
  "fleet_position_observations",
  "google_links",
  "login_rate_limits",
  "sessions",
  "sites",
  "subscriptions",
  "trip_position_observations",
  "trips",
] as const;

export const REQUIRED_POSTGRES_COLUMNS = [
  { table: "companies", column: "credentials_ciphertext" },
  { table: "companies", column: "brand_name" },
  { table: "companies", column: "brand_logo_data_url" },
  { table: "companies", column: "brand_color" },
  { table: "companies", column: "unload_grace_minutes" },
  { table: "companies", column: "ctm_relay_grace_minutes" },
  { table: "companies", column: "ctm_relay_auto_completion_enabled" },
  { table: "deliveries", column: "origin_site_id" },
  { table: "deliveries", column: "destination_site_id" },
  { table: "deliveries", column: "next_truck_departure_at" },
  { table: "deliveries", column: "trip_id" },
  { table: "deliveries", column: "shipment_id" },
  { table: "deliveries", column: "whatsapp_opt_in" },
  { table: "deliveries", column: "whatsapp_opt_in_at" },
  { table: "deliveries", column: "recipient_name" },
  { table: "deliveries", column: "recipient_contact" },
  { table: "deliveries", column: "recipient_whatsapp_opt_in" },
  { table: "deliveries", column: "recipient_whatsapp_opt_in_at" },
  { table: "deliveries", column: "weight_kg" },
  { table: "deliveries", column: "price_amount" },
  { table: "deliveries", column: "price_currency" },
  { table: "deliveries", column: "item_description" },
  { table: "deliveries", column: "customer_email" },
  { table: "delivery_eta_observations", column: "route_template_id" },
  { table: "delivery_eta_observations", column: "trip_instance_id" },
  { table: "delivery_eta_observations", column: "destination_site_id" },
  { table: "delivery_eta_observations", column: "company_id" },
  { table: "fleet_position_observations", column: "position_at" },
  { table: "sessions", column: "company_id" },
  { table: "sessions", column: "credentials_ciphertext" },
  { table: "sites", column: "arrival_radius_km" },
  { table: "trip_position_observations", column: "route_template_id" },
  { table: "trips", column: "stops_json" },
] as const;

export type PostgresSchemaProbe = {
  compatible: boolean;
  missing_tables: unknown;
  missing_columns: unknown;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function normalizePostgresSchemaProbe(row: PostgresSchemaProbe | null | undefined) {
  return {
    compatible: row?.compatible === true,
    missingTables: stringArray(row?.missing_tables),
    missingColumns: stringArray(row?.missing_columns),
  };
}
