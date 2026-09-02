import { getSqlOrNull } from "./pg-client.ts";
import { runtimeEnv } from "trackfleet-runtime-env";

const maxCompanies = 5;
const maxFleetPositionsPerCompany = 100;
const maxTripPositionsPerCompany = 100;
const d1BatchSize = 50;
const maxD1StatementsPerPass = 1000;
// Bounds how far back a first-ever (or long-overdue) sync catches up --
// beyond this, rely on the maxPositionsPerCompany LIMIT as the safety net
// instead of pulling unbounded history.
const maxCatchUpWindowMs = 24 * 60 * 60 * 1000;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
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
  if (statements.length > maxD1StatementsPerPass) throw new Error("d1_telemetry_reconciliation_budget_exceeded");
  for (let index = 0; index < statements.length; index += d1BatchSize) {
    await d1.batch(statements.slice(index, index + d1BatchSize));
  }
}

async function recordState(d1: D1Binding, column: "last_attempt_at" | "last_success_at" | "last_failure_at", at: number) {
  const query = column === "last_attempt_at"
    ? `INSERT INTO automation_runtime_state (id, last_attempt_at) VALUES ('d1_telemetry_reconciliation', ?)
       ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`
    : column === "last_success_at"
      ? `INSERT INTO automation_runtime_state (id, last_success_at) VALUES ('d1_telemetry_reconciliation', ?)
         ON CONFLICT(id) DO UPDATE SET last_success_at = excluded.last_success_at`
      : `INSERT INTO automation_runtime_state (id, last_failure_at) VALUES ('d1_telemetry_reconciliation', ?)
         ON CONFLICT(id) DO UPDATE SET last_failure_at = excluded.last_failure_at`;
  await d1.prepare(query).bind(at).run();
}

export async function reconcileD1Telemetry(): Promise<D1TelemetryReconciliationResult> {
  const d1 = db();
  if (!d1) return { ran: false, reason: "d1_not_bound", companies: 0, fleetPositions: 0, tripPositions: 0 };
  const sql = getSqlOrNull();
  if (!sql) return { ran: false, reason: "postgres_not_configured", companies: 0, fleetPositions: 0, tripPositions: 0 };

  // Only rows newer than the last successful sync need re-writing -- D1's
  // ON CONFLICT upsert made every previously-synced position count as a
  // fresh write every 15 minutes even though its content never changed,
  // which is what drove this job to be one of the top D1 rows_written
  // consumers (see the 2026-09-01 investigation).
  const watermark = await d1.prepare(`SELECT last_success_at FROM automation_runtime_state WHERE id = 'd1_telemetry_reconciliation' LIMIT 1`)
    .first<{ last_success_at: number | null }>();
  const sinceMs = watermark?.last_success_at ? Math.max(watermark.last_success_at, Date.now() - maxCatchUpWindowMs) : Date.now() - maxCatchUpWindowMs;
  const since = new Date(sinceMs);

  await recordState(d1, "last_attempt_at", Date.now());
  try {
    const companies = await sql`SELECT company_id AS id FROM deliveries
      WHERE company_id IS NOT NULL AND company_id <> ''
      GROUP BY company_id ORDER BY MAX(created_at) DESC LIMIT ${maxCompanies}` as Array<{ id: string }>;

    const statements: D1Statement[] = [];
    let fleetPositions = 0;
    let tripPositions = 0;
    for (const { id: companyId } of companies) {
      const fleetPromise = sql`SELECT company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at
        FROM fleet_position_observations WHERE company_id = ${companyId} AND position_at > ${since}
        ORDER BY position_at DESC LIMIT ${maxFleetPositionsPerCompany}`
        .then((rows) => rows as unknown as FleetPositionRow[]);
      const tripPromise = sql`SELECT company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
        FROM trip_position_observations WHERE company_id = ${companyId} AND position_at > ${since}
        ORDER BY position_at DESC LIMIT ${maxTripPositionsPerCompany}`
        .then((rows) => rows as unknown as TripPositionRow[]);
      const [fleetRows, tripRows] = await Promise.all([fleetPromise, tripPromise]);
      fleetPositions += fleetRows.length;
      tripPositions += tripRows.length;
      statements.push(...fleetRows.map((row) => fleetStatement(d1, row)));
      statements.push(...tripRows.map((row) => tripStatement(d1, row)));
    }

    await runBatches(d1, statements);
    await recordState(d1, "last_success_at", Date.now());
    return { ran: true, reason: "ok", companies: companies.length, fleetPositions, tripPositions };
  } catch (error) {
    try {
      await recordState(d1, "last_failure_at", Date.now());
    } catch (stateError) {
      console.error("[trackfleet:d1] failed to persist telemetry reconciliation failure state", {
        message: stateError instanceof Error ? stateError.message : "unknown_error",
      });
    }
    throw error;
  }
}
