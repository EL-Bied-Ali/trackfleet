export type VehicleAlias = {
  companyId: string;
  sendatrackVehicleId: string;
  alias: string;
  updatedAt: Date;
};

export type SetVehicleAliasInput = {
  companyId: string;
  sendatrackVehicleId: string;
  alias: string;
};

export interface VehicleAliasStore {
  listForCompany(companyId: string): Promise<VehicleAlias[]>;
  set(input: SetVehicleAliasInput): Promise<VehicleAlias>;
}
