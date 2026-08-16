import type { KnownSite } from "./known-sites";

export type CompanySite = KnownSite & {
  companyId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCompanySiteInput = Omit<CompanySite, "createdAt" | "updatedAt">;

export interface SiteStore {
  listForCompany(companyId: string): Promise<CompanySite[]>;
  upsert(input: CreateCompanySiteInput): Promise<CompanySite>;
}
