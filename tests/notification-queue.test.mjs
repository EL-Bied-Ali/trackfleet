import assert from "node:assert/strict";
import test from "node:test";
import { store } from "../app/lib/delivery-store.vercel.ts";

test("notification claim is deduplicated, retryable, then final after success", async () => {
  const deliveryId = "TF-2841";
  const eventType = "PROGRESS_25";
  await store.recordEvent(deliveryId, eventType, 25);

  let pending = await store.listPendingNotifications("demo");
  assert.ok(pending.some((item) => item.delivery.id === deliveryId && item.event.type === eventType));

  assert.equal(await store.claimNotification(deliveryId, eventType), true);
  assert.equal(await store.claimNotification(deliveryId, eventType), false);
  pending = await store.listPendingNotifications("demo");
  assert.equal(pending.some((item) => item.delivery.id === deliveryId && item.event.type === eventType), false);

  await store.releaseNotification(deliveryId, eventType);
  pending = await store.listPendingNotifications("demo");
  assert.ok(pending.some((item) => item.delivery.id === deliveryId && item.event.type === eventType));

  assert.equal(await store.claimNotification(deliveryId, eventType), true);
  await store.markNotificationSent(deliveryId, eventType);
  pending = await store.listPendingNotifications("demo");
  assert.equal(pending.some((item) => item.delivery.id === deliveryId && item.event.type === eventType), false);
});
