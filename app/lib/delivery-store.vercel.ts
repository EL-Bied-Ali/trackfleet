import { seedDeliveries } from "./delivery-seed";
import type { CreateDeliveryInput, DeliveryRow, DeliveryStore } from "./delivery-store.types";
import type { SendatrackSnapshot } from "./sendatrack";

const deliveryStore = seedDeliveries.map((delivery) => ({ ...delivery }));

function key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const store: DeliveryStore = {
  async getPublic(tracking) {
    return deliveryStore.find((delivery) =>
      delivery.trackingToken === tracking || (delivery.companyId === "demo" && delivery.id === tracking)) ?? null;
  },

  async listForCompany(companyId) {
    return deliveryStore
      .filter((delivery) => delivery.companyId === companyId || delivery.companyId === "demo")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },

  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    if (!snapshot.connected || !snapshot.vehicles.length) return;
    for (const delivery of deliveryStore) {
      if (delivery.status === "Delivered" || (delivery.companyId !== companyId && delivery.companyId !== "demo")) continue;
      const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId)
        ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
      if (!vehicle) continue;
      delivery.sendatrackVehicleId = vehicle.id;
      delivery.truck = vehicle.name;
      delivery.latitude = vehicle.latitude;
      delivery.longitude = vehicle.longitude;
      delivery.speed = vehicle.speed;
      delivery.lastPositionAt = new Date(vehicle.updatedAt);
      delivery.gpsSource = "sendatrack";
    }
  },

  async create(input: CreateDeliveryInput) {
    const delivery: DeliveryRow = {
      ...input,
      id: `TF-${String(Date.now()).slice(-6)}`,
      createdAt: new Date(),
    };
    deliveryStore.push(delivery);
    return delivery;
  },
};
