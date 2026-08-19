import {
  createServerSession as createPrimarySession,
  deleteServerSession as deletePrimarySession,
  getServerSession as getPrimarySession,
  type StoredCompanySession,
} from "./auth-session-store.shared-postgres";
import { getServerSession as getStandbySession } from "./auth-session-store.cloudflare";
import { withD1ReadFailover } from "./d1-read-failover";

export async function createServerSession(input: StoredCompanySession) {
  return createPrimarySession(input);
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  return withD1ReadFailover(
    "session.get",
    () => getPrimarySession(tokenHash),
    () => getStandbySession(tokenHash),
  );
}

export async function deleteServerSession(tokenHash: string) {
  return deletePrimarySession(tokenHash);
}

export type { StoredCompanySession };
