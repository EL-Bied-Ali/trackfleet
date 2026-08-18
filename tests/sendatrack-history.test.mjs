import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSendatrackHistory, segmentSendatrackHistoryTrips } from "../app/lib/sendatrack-history.ts";

const payload = {
  DeviceList: [
    {
      Device: "v11",
      DeviceCode: "truck-code-11",
      Device_desc: "Truck 11",
      EventData: [
        { Timestamp: 1_700_000_300, GPSPoint_lat: 35.3, GPSPoint_lon: -5.4, Speed: 0, Odometer: 1015, Address: "Tanger", StatusCode: 62467 },
        { Timestamp: 1_700_000_000, GPSPoint_lat: 34.0, GPSPoint_lon: -6.8, Speed: 0, Odometer: 1000, Address: "Rabat", StatusCode: 62465 },
        { Timestamp: 1_700_000_120, GPSPoint_lat: 34.5, GPSPoint_lon: -6.2, Speed: 75, Odometer: 1007, Address: "Autoroute", StatusCode: 61715 },
      ],
    },
  ],
};

test("normalizes SENDATRACK DeviceList/EventData history in timestamp order", () => {
  const points = normalizeSendatrackHistory(payload);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((point) => point.timestamp), [1_700_000_000, 1_700_000_120, 1_700_000_300]);
  assert.equal(points[0].deviceId, "truck-code-11");
  assert.equal(points[1].speed, 75);
  assert.equal(points[2].address, "Tanger");
});

test("segments a completed historical trip from SENDATRACK status events", () => {
  const trips = segmentSendatrackHistoryTrips(normalizeSendatrackHistory(payload));
  assert.equal(trips.length, 1);
  assert.equal(trips[0].deviceId, "truck-code-11");
  assert.equal(trips[0].startedAt, 1_700_000_000);
  assert.equal(trips[0].endedAt, 1_700_000_300);
  assert.equal(trips[0].durationSeconds, 300);
  assert.equal(trips[0].distance, 15);
  assert.equal(trips[0].startAddress, "Rabat");
  assert.equal(trips[0].endAddress, "Tanger");
  assert.equal(trips[0].points.length, 3);
});

test("rejects invalid GPS events and deduplicates identical history points", () => {
  const dirty = {
    DeviceList: [{
      Device: "v3",
      EventData: [
        { Timestamp: 1000, GPSPoint_lat: 40, GPSPoint_lon: 2, StatusCode: 62465 },
        { Timestamp: 1000, GPSPoint_lat: 40, GPSPoint_lon: 2, StatusCode: 62465 },
        { Timestamp: 1100, GPSPoint_lat: 140, GPSPoint_lon: 2, StatusCode: 62467 },
        { Timestamp: null, GPSPoint_lat: 41, GPSPoint_lon: 2, StatusCode: 62467 },
      ],
    }],
  };
  assert.equal(normalizeSendatrackHistory(dirty).length, 1);
});

test("does not fabricate a completed trip when no stop event exists", () => {
  const incomplete = {
    DeviceList: [{
      Device: "v9",
      EventData: [
        { Timestamp: 2000, GPSPoint_lat: 35, GPSPoint_lon: -5, Odometer: 20, StatusCode: 61714 },
        { Timestamp: 2300, GPSPoint_lat: 35.5, GPSPoint_lon: -5.2, Odometer: 25, StatusCode: 61715 },
      ],
    }],
  };
  assert.deepEqual(segmentSendatrackHistoryTrips(normalizeSendatrackHistory(incomplete)), []);
});
