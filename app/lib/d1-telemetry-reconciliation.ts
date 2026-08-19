import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";

const maxCompanies = 50;
const maxFleetPositionsPerCompany = 2000;
const maxTripPositionsPerCompany = 2000;
const d1BatchSize = 50;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
};

type D1Binding = {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
};

type FleetPositionRow = {
  company_id: string;
  vehicle_id: string;
  vehicle_name: string;
  position_at: string | Date;
  latitude: number | string;
  longitude: number | string;
  speed: number | string;
  heading: number | string | null;
  address: string | null;
  created_at: string | Date;
};

type TripPositionRow = {
  company_id: string;
  route_template_id: string;
  trip_instance_id: string;
  vehicle_id: string;
  position_at: string | Date;
  latitude: number | string;
  longitude: number | string;
  speed: number | string;
  created_at: string | Date;
};

export type D1TelemetryReconciliationResult = {
  ran: boolean;
  reason: "ok" | "d1_not_bound" | "postgres_not_configured";
  companies: number;
  fleetPositions: number;
  tripPositions: number;
};

function db() {
  return (runtimeEnv as unknown as { DB?: D1Binding }).DB ?? null;
}

function databaseUrl() {
  return runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
}

function fleetStatement(d1: D1Binding, row: FleetPositionRow) {
  return d1.prepare(`INSERT INTO fleet_position_observations (
    company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(company_id, vehicle_id, position_at) DO UPDATE SET
    vehicle_name = excluded.vehicle_name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    speed = excluded.speed,
    heading = excluded.heading,
    address = excluded.address,
    created_at = excluded.created_at`)
    .bind(
      row.company_id,
      row.vehicle_id,
      row.vehicle_name,
      new Date(row.position_at).getTime(),
      Number(row.latitude),
      Number(row.longitude),
      Number(row.speed),
      row.heading == null ? null : Number(row.heading),
      row.address ?? "",
      new Date(row.created_at).getTime(),
    );
}

function tripStatement(d1: D1Binding, row: TripPositionRow) {
  return d1.prepare(`INSERT INTO trip_position_observations (
    company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(company_id, trip_instance_id, position_at) DO UPDATE SET
    route_template_id = excluded.route_template_id,
    vehicle_id = excluded.vehicle_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    speed = excluded.speed,
    created_at = excluded.created_at`)
    .bind(
      row.company_id,
      row.route_template_id,
      row.trip_instance_id,
      row.vehicle_id,
      new Date(row.position_at).getTime(),
      Number(row.latitude),
      Number(row.longitude),
      Number(row.speed),
      new Date(row.created_at).getTime(),
    );
}

async function runBatches(d1: D1Binding, statements: D1Statement[]) {
  for (let index = 0; index < statements.length; index += d1BatchSize) {
    await d1.batch(statements.slice(index, index + d1BatchSize));
  }
}

export async function reconcileD1Telemetry(): Promise<D1TelemetryReconciliationResult> {
  const d1 = db();
  if (!d1) return { ran: false, reason: "d1_not_bound", companies: 0, fleetPositions: 0, tripPositions: 0 };
  const url = databaseUrl();
  if (!url) return { ran: false, reason: "postgres_not_configured", companies: 0, fleetPositions: 0, tripPositions: 0 };

  const sql = neon(url);
  const companies = await sql`SELECT company_id AS id FROM deliveries
    WHERE company_id IS NOT NULL AND company_id <> ''
    GROUP BY company_id ORDER BY MAX(created_at) DESC LIMIT ${maxCompanies}` as Array<{ id: string }>;

  const statements: D1Statement[] = [];
  let fleetPositions = 0;
  let tripPositions = 0;
  for (const { id: companyId } of companies) {
    const [fleetRows, tripRows] = await Promise.all([
      sql`SELECT company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at
        FROM fleet_position_observations WHERE company_id = ${companyId}
        ORDER BY position_at DESC LIMIT ${maxFleetPositionsPerCompany}` as Promise<FleetPositionRow[]>,
      sql`SELECT company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
        FROM trip_position_observations WHERE company_id = ${companyId}
        ORDER BY position_at DESC LIMIT ${maxTripPositionsPerCompany}` as Promise<TripPositionRow[]>,
    ]);
    fleetPositions += fleetRows.length;
    tripPositions += tripRows.length;
    statements.push(...fleetRows.map((row) => fleetStatement(d1, row)));
    statements.push(...tripRows.map((row) => tripStatement(d1, row)));
  }

  await runBatches(d1, statements);
  return { ran: true, reason: "ok", companies: companies.length, fleetPositions, tripPositions };
}
