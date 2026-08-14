"use client";

import { useEffect, useMemo, useState } from "react";

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";

type Delivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  progress: number;
  color: string;
};

const initialDeliveries: Delivery[] = [
  { id: "TF-2841", customer: "Boulangerie Louise", destination: "Ghent, BE", truck: "TRK-014", driver: "Marc D.", status: "In transit", eta: "14:25", progress: 72, color: "#16a272" },
  { id: "TF-2839", customer: "Atelier Noord", destination: "Antwerp, BE", truck: "TRK-007", driver: "Sophie L.", status: "Delayed", eta: "15:10", progress: 54, color: "#f1a43c" },
  { id: "TF-2837", customer: "Maison du Parc", destination: "Brussels, BE", truck: "TRK-019", driver: "Youssef B.", status: "In transit", eta: "13:50", progress: 88, color: "#4776e6" },
  { id: "TF-2835", customer: "Café Central", destination: "Leuven, BE", truck: "TRK-003", driver: "Nora V.", status: "Loading", eta: "16:30", progress: 12, color: "#916ed7" },
  { id: "TF-2832", customer: "Studio Meuse", destination: "Liège, BE", truck: "TRK-011", driver: "Alex R.", status: "Delivered", eta: "12:18", progress: 100, color: "#6b7280" },
];

const statusClass: Record<DeliveryStatus, string> = {
  "In transit": "status transit",
  Delayed: "status delayed",
  Loading: "status loading",
  Delivered: "status delivered",
};

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [selectedId, setSelectedId] = useState("TF-2841");
  const [view, setView] = useState<"dispatch" | "customer">("dispatch");
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState("All deliveries");

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = deliveries.find((item) => item.id === selectedId) ?? deliveries[0];
  const visibleDeliveries = useMemo(() => {
    if (filter === "All deliveries") return deliveries;
    return deliveries.filter((delivery) => delivery.status === filter);
  }, [deliveries, filter]);

  function copyTrackingLink() {
    const link = `${window.location.origin}/?tracking=${selected.id}`;
    navigator.clipboard?.writeText(link);
    setToast("Private tracking link copied");
  }

  function createDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const truck = String(form.get("truck"));
    const nextNumber = 2842 + deliveries.length;
    const newDelivery: Delivery = {
      id: `TF-${nextNumber}`,
      customer: String(form.get("customer")),
      destination: String(form.get("destination")),
      truck,
      driver: "To be assigned",
      status: "Loading",
      eta: String(form.get("eta")),
      progress: 8,
      color: "#916ed7",
    };
    setDeliveries((items) => [newDelivery, ...items]);
    setSelectedId(newDelivery.id);
    setModalOpen(false);
    setToast(`${newDelivery.id} created — tracking link ready`);
  }

  if (view === "customer") {
    return (
      <main className="customer-page">
        <header className="customer-header">
          <a className="brand brand-dark" href="#" onClick={(event) => { event.preventDefault(); setView("dispatch"); }}>
            <span className="brand-mark"><span>↗</span></span>
            <span>TrackFleet</span>
          </a>
          <div className="secure-pill"><span>●</span> Secure tracking link</div>
        </header>

        <section className="customer-content">
          <div className="customer-intro">
            <div>
              <p className="eyebrow">DELIVERY {selected.id}</p>
              <h1>Your delivery is on the way.</h1>
              <p className="customer-subtitle">We’ll keep this page updated as your shipment travels to {selected.destination}.</p>
            </div>
            <div className="eta-card">
              <span>Estimated arrival</span>
              <strong>{selected.eta}</strong>
              <small>Today · On schedule</small>
            </div>
          </div>

          <div className="customer-grid">
            <div className="map customer-map">
              <div className="map-grid" />
              <div className="river river-one" />
              <div className="road road-a" />
              <div className="road road-b" />
              <div className="road road-c" />
              <span className="city city-a">BRUSSELS</span>
              <span className="city city-b">LEUVEN</span>
              <span className="city city-c">MECHELEN</span>
              <div className="route-line" />
              <div className="destination-pin"><span>◆</span></div>
              <div className="truck-pin hero-pin" style={{ transform: `translate(${(tick % 4) * 3}px, ${-(tick % 4) * 2}px)` }}>
                <span>▰</span>
              </div>
              <div className="map-live"><i /> Live · updated just now</div>
              <div className="map-controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div>
            </div>

            <aside className="journey-card">
              <div className="journey-title">
                <div className="mini-truck">▰</div>
                <div><strong>{selected.truck}</strong><span>Your delivery vehicle</span></div>
              </div>
              <div className="timeline">
                <div className="timeline-step done"><i>✓</i><div><strong>Order prepared</strong><span>Today, 08:42</span></div></div>
                <div className="timeline-step done"><i>✓</i><div><strong>Left the warehouse</strong><span>Today, 10:16</span></div></div>
                <div className="timeline-step active"><i>●</i><div><strong>In transit</strong><span>{selected.progress}% of the journey complete</span></div></div>
                <div className="timeline-step"><i>◆</i><div><strong>Arriving at destination</strong><span>Expected around {selected.eta}</span></div></div>
              </div>
              <div className="privacy-note"><Icon>⌁</Icon><p><strong>Your privacy matters</strong><span>This link only shows the vehicle carrying your delivery and expires after arrival.</span></p></div>
            </aside>
          </div>

          <div className="customer-footer"><span>Need help with this delivery?</span><button>Contact TrackFleet support <span>→</span></button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></a>
        <nav aria-label="Main navigation">
          <button className="nav-item active"><Icon>▦</Icon>Overview</button>
          <button className="nav-item"><Icon>▰</Icon>Fleet <span className="nav-count">20</span></button>
          <button className="nav-item"><Icon>◇</Icon>Deliveries <span className="nav-count">18</span></button>
          <button className="nav-item"><Icon>◉</Icon>Customers</button>
        </nav>
        <div className="sidebar-divider" />
        <nav>
          <button className="nav-item"><Icon>⚙</Icon>Settings</button>
          <button className="nav-item"><Icon>?</Icon>Help centre</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="gps-card">
          <div className="gps-icon">⌖</div>
          <strong>GPS simulation active</strong>
          <p>Connect your provider when the device details are ready.</p>
          <button>Connection settings</button>
        </div>
        <div className="profile"><div className="avatar">CM</div><div><strong>Camille Moreau</strong><span>Dispatcher</span></div><button aria-label="Open profile menu">⋮</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><h1>Good afternoon, Camille</h1><p>Here’s what’s moving across your fleet today.</p></div>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<i /></button><button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>New delivery</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>Active deliveries</span><Icon>◇</Icon></div><div><strong>14</strong><em className="up">↗ 12%</em></div><p>Across 12 vehicles</p></article>
          <article className="stat-card"><div className="stat-head"><span>On-time rate</span><Icon>◷</Icon></div><div><strong>94.2%</strong><em className="up">↗ 2.4%</em></div><p>Last 30 days</p></article>
          <article className="stat-card"><div className="stat-head"><span>Delayed</span><Icon>△</Icon></div><div><strong>3</strong><em className="warning">Needs attention</em></div><p>2 traffic · 1 loading</p></article>
          <article className="stat-card"><div className="stat-head"><span>Fleet status</span><Icon>▰</Icon></div><div><strong>17 / 20</strong><em className="neutral">3 at depot</em></div><p>All devices reporting</p></article>
        </div>

        <div className="map-panel">
          <div className="panel-header"><div><h2>Live fleet</h2><p>Vehicle positions update every 30 seconds</p></div><div className="panel-actions"><button><Icon>⌕</Icon>Find vehicle</button><button><Icon>☷</Icon>Map layers</button></div></div>
          <div className="map fleet-map">
            <div className="map-grid" />
            <div className="river river-one" /><div className="river river-two" />
            <div className="road road-a" /><div className="road road-b" /><div className="road road-c" /><div className="road road-d" />
            <span className="city city-a">BRUSSELS</span><span className="city city-b">LEUVEN</span><span className="city city-c">MECHELEN</span><span className="city city-d">WAVRE</span>
            {deliveries.slice(0, 4).map((delivery, index) => (
              <button key={delivery.id} className={`truck-pin pin-${index + 1} ${selectedId === delivery.id ? "selected" : ""}`} onClick={() => setSelectedId(delivery.id)} aria-label={`Select ${delivery.truck}`} style={{ transform: `translate(${index === 0 ? (tick % 4) * 2 : 0}px, ${index === 0 ? -(tick % 3) * 2 : 0}px)` }}>
                <span>▰</span><b>{delivery.truck.replace("TRK-0", "")}</b>
              </button>
            ))}
            <div className="map-status"><i /> 20 vehicles reporting</div>
            <div className="map-controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div>
            <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p><strong>{selected.truck}</strong><small>{selected.driver}</small></p><button aria-label="Close details">×</button></div>
              <dl><div><dt>Status</dt><dd><i />{selected.status}</dd></div><div><dt>Delivery</dt><dd>{selected.id}</dd></div><div><dt>ETA</dt><dd>{selected.eta}</dd></div></dl>
              <div className="popover-actions"><button onClick={() => setView("customer")}>Open tracking page <span>↗</span></button><button aria-label="More options">•••</button></div>
            </div>
          </div>
        </div>

        <div className="deliveries-panel">
          <div className="panel-header delivery-head"><div><h2>Today’s deliveries</h2><p>18 scheduled · 6 completed</p></div><div className="panel-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter deliveries"><option>All deliveries</option><option>In transit</option><option>Delayed</option><option>Loading</option><option>Delivered</option></select><button>View all <span>→</span></button></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Delivery</th><th>Customer</th><th>Vehicle</th><th>Status</th><th>ETA</th><th>Progress</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} onClick={() => setSelectedId(delivery.id)} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{delivery.id}</strong><span>{delivery.destination}</span></td><td><div className="customer-cell"><i style={{ background: delivery.color }}>{delivery.customer.split(" ").map((word) => word[0]).slice(0,2).join("")}</i><span>{delivery.customer}</span></div></td><td><strong>{delivery.truck}</strong><span>{delivery.driver}</span></td><td><span className={statusClass[delivery.status]}><i />{delivery.status}</span></td><td><strong>{delivery.eta}</strong><span>{delivery.status === "Delayed" ? "+18 min" : delivery.status === "Delivered" ? "Arrived" : "Today"}</span></td><td><div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div></td><td><button className="more-button" aria-label={`Options for ${delivery.id}`}>•••</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">NEW SHIPMENT</p><h2 id="new-delivery-title">Create a delivery</h2><span>A private customer tracking link will be generated automatically.</span></div><button onClick={() => setModalOpen(false)} aria-label="Close">×</button></div><form onSubmit={createDelivery}><label>Customer or company<input name="customer" required placeholder="e.g. Atelier Brussels" /></label><label>Delivery destination<input name="destination" required placeholder="City, country" /></label><div className="form-row"><label>Assign truck<select name="truck" defaultValue="TRK-005"><option>TRK-005</option><option>TRK-008</option><option>TRK-012</option><option>TRK-017</option></select></label><label>Expected arrival<input name="eta" required type="time" defaultValue="15:30" /></label></div><label>Customer contact <span>(optional)</span><input name="contact" placeholder="Email or phone number" /></label><div className="modal-footer"><button type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary-button" type="submit">Create delivery <span>→</span></button></div></form></section></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
