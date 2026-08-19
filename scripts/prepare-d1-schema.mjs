import { execFileSync } from "node:child_process";

const databaseName = process.env.TRACKFLEET_D1_DATABASE_NAME?.trim() || "trackfleet-db";
const mode = process.argv.includes("--local") ? "--local" : "--remote";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function execute(sql, { json = false } = {}) {
  const args = ["exec", "wrangler", "d1", "execute", databaseName, mode, "--command", sql];
  if (json) args.push("--json");
  const output = execFileSync(pnpm, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });
  return json ? JSON.parse(output) : output;
}

function rowsFromWrangler(payload) {
  if (!Array.isArray(payload)) return [];
  for (const entry of payload) {
    if (Array.isArray(entry?.results)) return entry.results;
    if (Array.isArray(entry?.result?.results)) return entry.result.results;
  }
  return [];
}

function columnsFor(table) {
  return new Set(
    rowsFromWrangler(execute(`PRAGMA table_info(${table})`, { json: true }))
      .map((row) => String(row?.name ?? ""))
      .filter(Boolean),
  );
}

function ensureColumn(table, columns, name, definition) {
  if (columns.has(name)) return;
  console.log(`[d1-schema] add ${table}.${name}`);
  execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

function run(sql) {
  execute(sql);
}

console.log(`[d1-schema] preparing ${databaseName} (${mode.slice(2)})`);

run(`CREATE TABLE IF NOT EXISTS deliveries (
  id text PRIMARY KEY NOT NULL,
  customer text NOT NULL,
  origin_site_id text,
  origin_latitude real,
  origin_longitude real,
  destination_site_id text,
  destination text NOT NULL,
  destination_latitude real,
  destination_longitude real,
  arrival_radius_km real DEFAULT 0.5 NOT NULL,
  truck text NOT NULL,
  driver text NOT NULL,
  status text NOT NULL,
  eta text NOT NULL,
  planned_arrival_at integer,
  progress integer DEFAULT 0 NOT NULL,
  color text DEFAULT '#916ed7' NOT NULL,
  contact text DEFAULT '' NOT NULL,
  whatsapp_opt_in integer DEFAULT 0 NOT NULL,
  whatsapp_opt_in_at integer,
  sendatrack_vehicle_id text DEFAULT '' NOT NULL,
  latitude real,
  longitude real,
  speed real,
  last_position_at integer,
  gps_source text DEFAULT 'simulation' NOT NULL,
  company_id text DEFAULT 'demo' NOT NULL,
  tracking_token text,
  trip_id text,
  created_at integer NOT NULL
)`);

const deliveryColumns = columnsFor("deliveries");
ensureColumn("deliveries", deliveryColumns, "origin_site_id", "text");
ensureColumn("deliveries", deliveryColumns, "origin_latitude", "real");
ensureColumn("deliveries", deliveryColumns, "origin_longitude", "real");
ensureColumn("deliveries", deliveryColumns, "destination_site_id", "text");
ensureColumn("deliveries", deliveryColumns, "destination_latitude", "real");
ensureColumn("deliveries", deliveryColumns, "destination_longitude", "real");
ensureColumn("deliveries", deliveryColumns, "arrival_radius_km", "real DEFAULT 0.5 NOT NULL");
ensureColumn("deliveries", deliveryColumns, "planned_arrival_at", "integer");
ensureColumn("deliveries", deliveryColumns, "trip_id", "text");
ensureColumn("deliveries", deliveryColumns, "whatsapp_opt_in", "integer DEFAULT 0 NOT NULL");
ensureColumn("deliveries", deliveryColumns, "whatsapp_opt_in_at", "integer");
ensureColumn("deliveries", deliveryColumns, "sendatrack_vehicle_id", "text DEFAULT '' NOT NULL");
ensureColumn("deliveries", deliveryColumns, "latitude", "real");
ensureColumn("deliveries", deliveryColumns, "longitude", "real");
ensureColumn("deliveries", deliveryColumns, "speed", "real");
ensureColumn("deliveries", deliveryColumns, "last_position_at", "integer");
ensureColumn("deliveries", deliveryColumns, "gps_source", "text DEFAULT 'simulation' NOT NULL");
ensureColumn("deliveries", deliveryColumns, "company_id", "text DEFAULT 'demo' NOT NULL");
ensureColumn("deliveries", deliveryColumns, "tracking_token", "text");

run(`CREATE TABLE IF NOT EXISTS delivery_events (
  delivery_id text NOT NULL,
  type text NOT NULL,
  progress integer NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (delivery_id, type)
)`);
run(`CREATE TABLE IF NOT EXISTS delivery_notifications (
  delivery_id text NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,
  attempted_at integer NOT NULL,
  sent_at integer,
  PRIMARY KEY (delivery_id, event_type, channel)
)`);
run(`CREATE TABLE IF NOT EXISTS delivery_eta_observations (
  delivery_id text NOT NULL,
  route_template_id text,
  trip_instance_id text,
  destination_site_id text,
  position_at integer NOT NULL,
  estimated_arrival_at integer NOT NULL,
  planned_arrival_at integer,
  delay_minutes integer,
  effective_speed_kmh real,
  remaining_distance_km real NOT NULL,
  progress integer NOT NULL,
  confidence text NOT NULL,
  source text NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (delivery_id, position_at)
)`);

const etaColumns = columnsFor("delivery_eta_observations");
ensureColumn("delivery_eta_observations", etaColumns, "route_template_id", "text");
ensureColumn("delivery_eta_observations", etaColumns, "trip_instance_id", "text");
ensureColumn("delivery_eta_observations", etaColumns, "destination_site_id", "text");

run(`CREATE TABLE IF NOT EXISTS trip_position_observations (
  company_id text NOT NULL,
  route_template_id text NOT NULL,
  trip_instance_id text NOT NULL,
  vehicle_id text NOT NULL,
  position_at integer NOT NULL,
  latitude real NOT NULL,
  longitude real NOT NULL,
  speed real NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (company_id, trip_instance_id, position_at)
)`);
run(`CREATE TABLE IF NOT EXISTS fleet_position_observations (
  company_id text NOT NULL,
  vehicle_id text NOT NULL,
  vehicle_name text NOT NULL,
  position_at integer NOT NULL,
  latitude real NOT NULL,
  longitude real NOT NULL,
  speed real NOT NULL,
  heading real,
  address text DEFAULT '' NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (company_id, vehicle_id, position_at)
)`);
run(`CREATE TABLE IF NOT EXISTS trips (
  id text NOT NULL,
  company_id text NOT NULL,
  route_template_id text NOT NULL,
  vehicle_key text NOT NULL,
  truck text NOT NULL,
  sendatrack_vehicle_id text DEFAULT '' NOT NULL,
  origin_site_id text,
  stops_json text NOT NULL,
  status text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY (company_id, id)
)`);
run(`CREATE TABLE IF NOT EXISTS sites (
  company_id text NOT NULL,
  id text NOT NULL,
  label text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  address text NOT NULL,
  latitude real,
  longitude real,
  arrival_radius_km real NOT NULL DEFAULT 0.5,
  roles text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY (company_id, id)
)`);
run(`CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY NOT NULL,
  account_label text NOT NULL,
  user_label text NOT NULL,
  credentials_ciphertext text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
)`);
run(`CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY NOT NULL,
  company_id text NOT NULL,
  account_label text,
  user_label text,
  credentials_ciphertext text,
  expires_at integer NOT NULL,
  created_at integer NOT NULL
)`);

const sessionColumns = columnsFor("sessions");
ensureColumn("sessions", sessionColumns, "company_id", "text");
ensureColumn("sessions", sessionColumns, "account_label", "text");
ensureColumn("sessions", sessionColumns, "user_label", "text");
ensureColumn("sessions", sessionColumns, "credentials_ciphertext", "text");

run(`CREATE TABLE IF NOT EXISTS login_rate_limits (
  client_key text PRIMARY KEY NOT NULL,
  window_started_at integer NOT NULL,
  attempts integer NOT NULL,
  updated_at integer NOT NULL
)`);
run(`CREATE TABLE IF NOT EXISTS delivery_arrival_state (
  company_id text NOT NULL,
  delivery_id text NOT NULL,
  arrived_at integer NOT NULL,
  last_observed_at integer,
  PRIMARY KEY (company_id, delivery_id)
)`);
const arrivalColumns = columnsFor("delivery_arrival_state");
ensureColumn("delivery_arrival_state", arrivalColumns, "last_observed_at", "integer");
run("UPDATE delivery_arrival_state SET last_observed_at = arrived_at WHERE last_observed_at IS NULL");
run(`CREATE TABLE IF NOT EXISTS telemetry_retention_state (
  company_id text PRIMARY KEY NOT NULL,
  last_pruned_at integer NOT NULL
)`);
run(`CREATE TABLE IF NOT EXISTS automation_runtime_state (
  id text PRIMARY KEY NOT NULL,
  last_attempt_at integer,
  last_success_at integer,
  last_failure_at integer
)`);

for (const sql of [
  "CREATE INDEX IF NOT EXISTS idx_deliveries_company_id ON deliveries(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_deliveries_company_trip ON deliveries(company_id, trip_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_tracking_token ON deliveries(tracking_token)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_id ON delivery_events(delivery_id)",
  "CREATE INDEX IF NOT EXISTS idx_eta_observations_delivery_position ON delivery_eta_observations(delivery_id, position_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_eta_observations_route_destination ON delivery_eta_observations(route_template_id, destination_site_id, position_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_trip_positions_company_route ON trip_position_observations(company_id, route_template_id, position_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_trip_positions_company_time ON trip_position_observations(company_id, position_at)",
  "CREATE INDEX IF NOT EXISTS idx_fleet_positions_company_vehicle ON fleet_position_observations(company_id, vehicle_id, position_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_fleet_positions_company_time ON fleet_position_observations(company_id, position_at)",
  "CREATE INDEX IF NOT EXISTS idx_trips_company_updated ON trips(company_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_login_rate_limits_updated_at ON login_rate_limits(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_arrival_state_arrived_at ON delivery_arrival_state(arrived_at)",
]) run(sql);

console.log("[d1-schema] ready");
