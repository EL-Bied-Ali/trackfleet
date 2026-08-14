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
  contact?: string;
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
  const [showPopover, setShowPopover] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function syncViewFromUrl() {
      const trackingId = new URLSearchParams(window.location.search).get("tracking");
      const matchingDelivery = deliveries.find((delivery) => delivery.id === trackingId);
      if (trackingId && matchingDelivery) {
        setSelectedId(matchingDelivery.id);
        setView("customer");
      } else {
        setView("dispatch");
      }
    }

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, [deliveries]);

  useEffect(() => {
    let active = true;
    fetch("/api/deliveries")
      .then((response) => {
        if (!response.ok) throw new Error("Delivery service unavailable");
        return response.json() as Promise<{ deliveries: Delivery[] }>;
      })
      .then((data) => {
        if (active && data.deliveries.length) setDeliveries(data.deliveries);
      })
      .catch(() => {
        if (active) setToast("Demo data loaded — cloud sync is reconnecting");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function closeModalWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", closeModalWithEscape);
    return () => window.removeEventListener("keydown", closeModalWithEscape);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = deliveries.find((item) => item.id === selectedId) ?? deliveries[0];
  const customerCopy: Record<DeliveryStatus, { headline: string; subtitle: string; etaNote: string; currentTitle: string; currentDetail: string; finalTitle: string; finalDetail: string }> = {
    "In transit": { headline: "Your delivery is on the way.", subtitle: `We’ll keep this page updated as your shipment travels to ${selected.destination}.`, etaNote: "Today · On schedule", currentTitle: "In transit", currentDetail: `${selected.progress}% of the journey complete`, finalTitle: "Arriving at destination", finalDetail: `Expected around ${selected.eta}` },
    Delayed: { headline: "Your delivery is running late.", subtitle: `Traffic has affected the journey to ${selected.destination}. The arrival estimate below is already updated.`, etaNote: "Today · Updated estimate", currentTitle: "Delayed in traffic", currentDetail: "The driver is continuing safely", finalTitle: "Continuing to destination", finalDetail: `Updated arrival around ${selected.eta}` },
    Loading: { headline: "Your delivery is being prepared.", subtitle: `Your shipment is being loaded before it leaves for ${selected.destination}.`, etaNote: "Today · Preparing", currentTitle: "Loading the vehicle", currentDetail: "Still at the warehouse", finalTitle: "Leaving the warehouse", finalDetail: `Expected arrival around ${selected.eta}` },
    Delivered: { headline: "Your delivery has arrived.", subtitle: `The shipment was delivered successfully in ${selected.destination}.`, etaNote: "Delivered today", currentTitle: "Delivered", currentDetail: `Arrived at ${selected.eta}`, finalTitle: "Delivery complete", finalDetail: "Thank you for choosing TrackFleet" },
  };
  const visibleDeliveries = useMemo(() => {
    if (filter === "All deliveries") return deliveries;
    return deliveries.filter((delivery) => delivery.status === filter);
  }, [deliveries, filter]);

  async function copyDeliveryLink(deliveryId: string) {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", deliveryId);
    try {
      await navigator.clipboard.writeText(link.toString());
      setToast("Private tracking link copied");
    } catch {
      const helper = document.createElement("textarea");
      helper.value = link.toString();
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      setToast(copied ? "Private tracking link copied" : "Couldn’t copy the link");
    }
  }

  async function copyTrackingLink() {
    await copyDeliveryLink(selected.id);
  }

  function openCustomerView() {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", selected.id);
    window.history.pushState({}, "", link);
    setView("customer");
  }

  function openDispatchView() {
    window.history.pushState({}, "", window.location.origin);
    setView("dispatch");
  }

  async function createDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const truck = String(form.get("truck"));
    const draftDelivery = {
      customer: String(form.get("customer")),
      destination: String(form.get("destination")),
      truck,
      eta: String(form.get("eta")),
      contact: String(form.get("contact")),
    };
    setCreating(true);
    try {
      const response = await fetch("/api/deliveries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftDelivery) });
      if (!response.ok) throw new Error("Could not save delivery");
      const data = (await response.json()) as { delivery: Delivery };
      setDeliveries((items) => [data.delivery, ...items.filter((item) => item.id !== data.delivery.id)]);
      setSelectedId(data.delivery.id);
      setShowPopover(true);
      setModalOpen(false);
      setToast(`${data.delivery.id} created — tracking link ready`);
    } catch {
      setToast("Couldn’t create the delivery — please try again");
    } finally {
      setCreating(false);
    }
  }

  if (view === "customer") {
    return (
      <main className="customer-page">
        <header className="customer-header">
          <a className="brand brand-dark" href="/" onClick={(event) => { event.preventDefault(); openDispatchView(); }}>
            <span className="brand-mark"><span>↗</span></span>
            <span>TrackFleet</span>
          </a>
          <div className="secure-pill"><span>●</span> Secure tracking link</div>
        </header>

        <section className="customer-content">
          <div className="customer-intro">
            <div>
              <p className="eyebrow">DELIVERY {selected.id}</p>
              <h1>{customerCopy[selected.status].headline}</h1>
              <p className="customer-subtitle">{customerCopy[selected.status].subtitle}</p>
            </div>
            <div className="eta-card">
              <span>Estimated arrival</span>
              <strong>{selected.eta}</strong>
              <small className={`eta-${selected.status.toLowerCase().replace(" ", "-")}`}>{customerCopy[selected.status].etaNote}</small>
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
            </div>

            <aside className="journey-card">
              <div className="journey-title">
                <div className="mini-truck">▰</div>
                <div><strong>{selected.truck}</strong><span>Your delivery vehicle</span></div>
              </div>
              <div className="timeline">
                <div className="timeline-step done"><i>✓</i><div><strong>Order prepared</strong><span>Today, 08:42</span></div></div>
                <div className="timeline-step done"><i>✓</i><div><strong>Left the warehouse</strong><span>Today, 10:16</span></div></div>
                <div className={`timeline-step active ${selected.status === "Delayed" ? "is-delayed" : ""}`}><i>●</i><div><strong>{customerCopy[selected.status].currentTitle}</strong><span>{customerCopy[selected.status].currentDetail}</span></div></div>
                <div className={selected.status === "Delivered" ? "timeline-step done" : "timeline-step"}><i>{selected.status === "Delivered" ? "✓" : "◆"}</i><div><strong>{customerCopy[selected.status].finalTitle}</strong><span>{customerCopy[selected.status].finalDetail}</span></div></div>
              </div>
              <div className="privacy-note"><Icon>⌁</Icon><p><strong>Your privacy matters</strong><span>This link only shows the vehicle carrying your delivery and expires after arrival.</span></p></div>
            </aside>
          </div>

          <div className="customer-footer"><span>Need help with this delivery?</span><strong>Contact the company that sent your tracking link.</strong></div>
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
          <button className="nav-item" disabled title="Available after GPS connection"><Icon>▰</Icon>Fleet <span className="nav-count">20</span></button>
          <button className="nav-item" disabled title="Available after GPS connection"><Icon>◇</Icon>Deliveries <span className="nav-count">18</span></button>
          <button className="nav-item" disabled title="Available after GPS connection"><Icon>◉</Icon>Customers</button>
        </nav>
        <div className="sidebar-divider" />
        <nav>
          <button className="nav-item" disabled><Icon>⚙</Icon>Settings</button>
          <button className="nav-item" disabled><Icon>?</Icon>Help centre</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="gps-card">
          <div className="gps-icon">⌖</div>
          <strong>GPS simulation active</strong>
          <p>Connect your provider when the device details are ready.</p>
          <span className="gps-coming">Connection settings unlock when provider details are added</span>
        </div>
        <div className="profile"><div className="avatar">CM</div><div><strong>Camille Moreau</strong><span>Dispatcher</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><h1>Good afternoon, Camille</h1><p>Here’s what’s moving across your fleet today.</p></div>
          <div className="top-actions"><button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>New delivery</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>Active deliveries</span><Icon>◇</Icon></div><div><strong>14</strong><em className="up">↗ 12%</em></div><p>Across 12 vehicles</p></article>
          <article className="stat-card"><div className="stat-head"><span>On-time rate</span><Icon>◷</Icon></div><div><strong>94.2%</strong><em className="up">↗ 2.4%</em></div><p>Last 30 days</p></article>
          <article className="stat-card"><div className="stat-head"><span>Delayed</span><Icon>△</Icon></div><div><strong>3</strong><em className="warning">Needs attention</em></div><p>2 traffic · 1 loading</p></article>
          <article className="stat-card"><div className="stat-head"><span>Fleet status</span><Icon>▰</Icon></div><div><strong>17 / 20</strong><em className="neutral">3 at depot</em></div><p>All devices reporting</p></article>
        </div>

        <div className="map-panel">
          <div className="panel-header"><div><h2>Live fleet</h2><p>Vehicle positions update every 30 seconds</p></div><div className="panel-actions"><select aria-label="Find vehicle" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.truck}</option>)}</select><button aria-pressed={showTraffic} onClick={() => setShowTraffic((value) => !value)}><Icon>☷</Icon>{showTraffic ? "Hide traffic" : "Show traffic"}</button></div></div>
          <div className={`map fleet-map ${showTraffic ? "traffic-visible" : ""}`}>
            <div className="map-grid" />
            <div className="river river-one" /><div className="river river-two" />
            <div className="road road-a" /><div className="road road-b" /><div className="road road-c" /><div className="road road-d" />
            <span className="city city-a">BRUSSELS</span><span className="city city-b">LEUVEN</span><span className="city city-c">MECHELEN</span><span className="city city-d">WAVRE</span>
            {deliveries.slice(0, 4).map((delivery, index) => (
              <button key={delivery.id} className={`truck-pin pin-${index + 1} ${selectedId === delivery.id ? "selected" : ""}`} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} aria-label={`Select ${delivery.truck}`} style={{ transform: `translate(${index === 0 ? (tick % 4) * 2 : 0}px, ${index === 0 ? -(tick % 3) * 2 : 0}px)` }}>
                <span>▰</span><b>{delivery.truck.replace("TRK-0", "")}</b>
              </button>
            ))}
            {showTraffic && <div className="traffic-layer" aria-label="Traffic conditions"><span>Moderate traffic</span><i /><i /><i /></div>}
            <div className="map-status"><i /> 20 vehicles reporting</div>
            {showPopover && <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p><strong>{selected.truck}</strong><small>{selected.driver}</small></p><button aria-label="Close details" onClick={() => setShowPopover(false)}>×</button></div>
              <dl><div><dt>Status</dt><dd><i />{selected.status}</dd></div><div><dt>Delivery</dt><dd>{selected.id}</dd></div><div><dt>ETA</dt><dd>{selected.eta}</dd></div></dl>
              <div className="popover-actions"><button onClick={openCustomerView}>Open tracking page <span>↗</span></button><button className="copy-link" onClick={copyTrackingLink}>Copy link</button></div>
            </div>}
          </div>
        </div>

        <div className="deliveries-panel">
          <div className="panel-header delivery-head"><div><h2>Today’s deliveries</h2><p>{visibleDeliveries.length} shown · {deliveries.filter((delivery) => delivery.status === "Delivered").length} completed</p></div><div className="panel-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter deliveries"><option>All deliveries</option><option>In transit</option><option>Delayed</option><option>Loading</option><option>Delivered</option></select></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Delivery</th><th>Customer</th><th>Vehicle</th><th>Status</th><th>ETA</th><th>Progress</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{delivery.id}</strong><span>{delivery.destination}</span></td><td><div className="customer-cell"><i style={{ background: delivery.color }}>{delivery.customer.split(" ").map((word) => word[0]).slice(0,2).join("")}</i><span>{delivery.customer}</span></div></td><td><strong>{delivery.truck}</strong><span>{delivery.driver}</span></td><td><span className={statusClass[delivery.status]}><i />{delivery.status}</span></td><td><strong>{delivery.eta}</strong><span>{delivery.status === "Delayed" ? "Updated" : delivery.status === "Delivered" ? "Arrived" : "Today"}</span></td><td><div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div></td><td><button className="more-button" aria-label={`Copy tracking link for ${delivery.id}`} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">NEW SHIPMENT</p><h2 id="new-delivery-title">Create a delivery</h2><span>A private customer tracking link will be generated automatically.</span></div><button onClick={() => setModalOpen(false)} aria-label="Close">×</button></div><form onSubmit={createDelivery}><label>Customer or company<input name="customer" required autoFocus placeholder="e.g. Atelier Brussels" /></label><label>Delivery destination<input name="destination" required placeholder="City, country" /></label><div className="form-row"><label>Assign truck<select name="truck" defaultValue="TRK-005"><option>TRK-005</option><option>TRK-008</option><option>TRK-012</option><option>TRK-017</option></select></label><label>Expected arrival<input name="eta" required type="time" defaultValue="15:30" /></label></div><label>Customer contact <span>(optional)</span><input name="contact" placeholder="Email or phone number" /></label><div className="modal-footer"><button type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={creating}>{creating ? "Creating…" : "Create delivery"}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
}
