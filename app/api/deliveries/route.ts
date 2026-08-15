import { desc } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { deliveries } from "../../../db/schema";

const seedDeliveries = [
  { id: "TF-2841", customer: "Atlas Home", destination: "Casablanca, MA", truck: "TRK-014", driver: "Youssef B.", status: "In transit" as const, eta: "19 Aug · 14:00–18:00", progress: 68, color: "#16a272", contact: "", createdAt: new Date("2026-08-14T08:42:00Z") },
  { id: "TF-2839", customer: "Medina Import", destination: "Tangier, MA", truck: "TRK-007", driver: "Sophie L.", status: "Delayed" as const, eta: "20 Aug · 09:00–13:00", progress: 55, color: "#f1a43c", contact: "", createdAt: new Date("2026-08-14T08:35:00Z") },
  { id: "TF-2837", customer: "Brussels Parts", destination: "Brussels, BE", truck: "TRK-019", driver: "Amine R.", status: "In transit" as const, eta: "18 Aug · 16:00–20:00", progress: 82, color: "#4776e6", contact: "", createdAt: new Date("2026-08-14T08:22:00Z") },
  { id: "TF-2835", customer: "Rif Logistics", destination: "Antwerp, BE", truck: "TRK-003", driver: "Nora V.", status: "Loading" as const, eta: "21 Aug · 10:00–14:00", progress: 8, color: "#916ed7", contact: "", createdAt: new Date("2026-08-14T08:10:00Z") },
  { id: "TF-2832", customer: "EuroMaghreb", destination: "Liège, BE", truck: "TRK-011", driver: "Marc D.", status: "Delivered" as const, eta: "17 Aug · 17:32", progress: 100, color: "#6b7280", contact: "", createdAt: new Date("2026-08-14T07:50:00Z") },
];

async function ensureSeedData() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
    id text PRIMARY KEY NOT NULL,
    customer text NOT NULL,
    destination text NOT NULL,
    truck text NOT NULL,
    driver text NOT NULL,
    status text NOT NULL,
    eta text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    color text DEFAULT '#916ed7' NOT NULL,
    contact text DEFAULT '' NOT NULL,
    created_at integer NOT NULL
  )`).run();
  const db = getDb();
  await db.insert(deliveries).values(seedDeliveries).onConflictDoNothing();
  for (const delivery of seedDeliveries) {
    await env.DB.prepare("UPDATE deliveries SET customer = ?, destination = ?, truck = ?, driver = ?, status = ?, eta = ?, progress = ?, color = ? WHERE id = ?")
      .bind(delivery.customer, delivery.destination, delivery.truck, delivery.driver, delivery.status, delivery.eta, delivery.progress, delivery.color, delivery.id)
      .run();
  }
  return db;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const db = await ensureSeedData();
    const rows = await db.select().from(deliveries).orderBy(desc(deliveries.createdAt));
    return Response.json({ deliveries: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const customer = String(payload.customer ?? "").trim();
    const destination = String(payload.destination ?? "").trim();
    const truck = String(payload.truck ?? "").trim();
    const eta = String(payload.eta ?? "").trim();

    if (!customer || !destination || !truck || !/^\d{2}:\d{2}$/.test(eta)) {
      return Response.json({ error: "customer, destination, truck, and a valid ETA are required" }, { status: 400 });
    }

    const db = await ensureSeedData();
    const id = `TF-${String(Date.now()).slice(-6)}`;
    const [delivery] = await db.insert(deliveries).values({
      id,
      customer,
      destination,
      truck,
      eta,
      contact: String(payload.contact ?? "").trim(),
      driver: "To be assigned",
      status: "Loading",
      progress: 8,
      color: "#916ed7",
      createdAt: new Date(),
    }).returning();

    return Response.json({ delivery }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
