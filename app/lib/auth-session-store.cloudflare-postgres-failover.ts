import {
  createServerSession as createPrimarySession,
  deleteServerSession as deletePrimarySession,
  renewServerSession as renewPrimarySession,
  getServerSession as getPrimarySession,
  getCompanyBranding as getPrimaryCompanyBranding,
  updateCompanyBranding as updatePrimaryCompanyBranding,
  getCompanyAutomationSettings as getPrimaryCompanyAutomationSettings,
  updateCompanyAutomationSettings as updatePrimaryCompanyAutomationSettings,
  type StoredCompanySession,
  type CompanyBranding,
  type CompanyAutomationSettings,
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

export async function getCompanyAutomationSettings(companyId: string): Promise<CompanyAutomationSettings | null> {
  return withD1ReadFailover(
    "company.getAutomationSettings",
    () => getPrimaryCompanyAutomationSettings(companyId),
    // Same reasoning as branding above: during an active D1 failover
    // (Postgres itself down) it's fine to fall back to every deploy-wide
    // default (null = "no override") rather than building a dedicated D1
    // standby read path for a settings tweak that isn't core functionality.
    async () => null,
  );
}

export async function updateCompanyAutomationSettings(companyId: string, input: CompanyAutomationSettings) {
  return suppressMaintenanceWriteDuringD1Failover(
    "company.updateAutomationSettings",
    () => updatePrimaryCompanyAutomationSettings(companyId, input),
    undefined,
  );
}

export type { StoredCompanySession, CompanyBranding, CompanyAutomationSettings };
