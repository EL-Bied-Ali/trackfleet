import { runtimeEnv } from "trackfleet-runtime-env";

const databaseUrl = runtimeEnv.DATABASE_URL?.trim();
if (databaseUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl;
}
