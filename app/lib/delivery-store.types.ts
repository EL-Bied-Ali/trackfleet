import type { SendatrackSnapshot } from "./sendatrack";

export type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";

export type DeliveryRow = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  progress: number;
  color: string;
  contact: string;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: Date | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  createdAt: Date;
};

export type CreateDeliveryInput = Omit<DeliveryRow, "id" | "trackingToken" | "createdAt"> & {
  trackingToken: string;
};

export interface DeliveryStore {
  getPublic(tracking: string): Promise<DeliveryRow | null>;
  listForCompany(companyId: string): Promise<DeliveryRow[]>;
  applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string): Promise<void>;
  create(input: CreateDeliveryInput): Promise<DeliveryRow>;
}
