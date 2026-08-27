import {
  createServerSession as createPrimarySession,
  deleteServerSession as deletePrimarySession,
  renewServerSession as renewPrimarySession,
  getServerSession as getPrimarySession,
  getCompanyBranding as getPrimaryCompanyBranding,
  updateCompanyBranding as updatePrimaryCompanyBranding,
  type StoredCompanySession,
  type CompanyBranding,
} from "./auth-session-store.shared-postgres";
import { getStandbySessionFromD1 } from "./d1-standby-session-read";
import { suppressMaintenanceWriteDuringD1Failover, withD1ReadFailover } from "./d1-read-failover";

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

export async function getCompanyBranding(companyId: string): Promise<CompanyBranding | null> {
  return withD1ReadFailover(
    "company.getBranding",
    () => getPrimaryCompanyBranding(companyId),
    // Branding is a display nicety, not core functionality -- during an
    // active D1 failover (Postgres itself down) it's fine to just fall back
    // to generic TrackFleet branding rather than building out a dedicated
    // D1 standby read path for it.
    async () => null,
  );
}

export async function updateCompanyBranding(companyId: string, input: CompanyBranding) {
  return suppressMaintenanceWriteDuringD1Failover(
    "company.updateBranding",
    () => updatePrimaryCompanyBranding(companyId, input),
    undefined,
  );
}

export type { StoredCompanySession, CompanyBranding };
