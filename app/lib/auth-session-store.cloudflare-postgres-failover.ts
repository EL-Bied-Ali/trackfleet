import {
  createServerSession as createPrimarySession,
  deleteServerSession as deletePrimarySession,
  renewServerSession as renewPrimarySession,
  getServerSession as getPrimarySession,
  type StoredCompanySession,
} from "./auth-session-store.shared-postgres";
import { getStandbySessionFromD1 } from "./d1-standby-session-read";
import { withD1ReadFailover } from "./d1-read-failover";

export async function createServerSession(input: StoredCompanySession) {
  return createPrimarySession(input);
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  return withD1ReadFailover(
    "session.get",
    () => getPrimarySession(tokenHash),
    () => getStandbySessionFromD1(tokenHash),
  );
}

export async function deleteServerSession(tokenHash: string) {
  return deletePrimarySession(tokenHash);
}

export async function renewServerSession(tokenHash: string, expiresAt: Date) {
  return renewPrimarySession(tokenHash, expiresAt);
}

export type { StoredCompanySession };
