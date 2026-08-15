"use client";

import { useEffect, useMemo, useState } from "react";
import { localeOptions, translations, type Locale } from "./i18n";

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

type MessageEvent = {
  id: string;
  deliveryId: string;
  kind: "tracking" | "arrival";
  time: string;
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

function LanguageSwitcher({ locale, label, onChange }: { locale: Locale; label: string; onChange: (locale: Locale) => void }) {
  return (
    <label className="language-switcher">
      <span className="language-symbol" aria-hidden="true">◎</span>
      <span className="sr-only">{label}</span>
      <select value={locale} onChange={(event) => onChange(event.target.value as Locale)} aria-label={label}>
        {localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
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
  const [locale, setLocale] = useState<Locale>("en");
  const [messageEvents, setMessageEvents] = useState<MessageEvent[]>([
    { id: "demo-tracking", deliveryId: "TF-2841", kind: "tracking", time: "13:06" },
  ]);
  const t = translations[locale];

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function syncViewFromUrl() {
      const searchParams = new URLSearchParams(window.location.search);
      const trackingId = searchParams.get("tracking");
      const requestedLocale = searchParams.get("lang");
      if (requestedLocale === "en" || requestedLocale === "fr" || requestedLocale === "nl") setLocale(requestedLocale);
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
    const requestedLocale = new URLSearchParams(window.location.search).get("lang");
    const savedLocale = window.localStorage.getItem("trackfleet-locale");
    if (!requestedLocale && (savedLocale === "en" || savedLocale === "fr" || savedLocale === "nl")) setLocale(savedLocale);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("trackfleet-locale", locale);
    document.documentElement.lang = locale === "nl" ? "nl-BE" : locale;
  }, [locale]);

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
        if (active) setToast(t.cloudReconnecting);
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
  const customerCopy = t.customerStatus[selected.status];
  const visibleDeliveries = useMemo(() => {
    if (filter === "All deliveries") return deliveries;
    return deliveries.filter((delivery) => delivery.status === filter);
  }, [deliveries, filter]);

  async function copyDeliveryLink(deliveryId: string) {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", deliveryId);
    link.searchParams.set("lang", locale);
    const helper = document.createElement("textarea");
    helper.value = link.toString();
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    let copied = document.execCommand("copy");
    helper.remove();
    if (!copied) {
      try {
        await navigator.clipboard.writeText(link.toString());
        copied = true;
      } catch {
        copied = false;
      }
    }
    setToast(copied ? t.linkCopied : t.copyFailed);
  }

  async function copyTrackingLink() {
    await copyDeliveryLink(selected.id);
  }

  function trackingUrl(deliveryId: string) {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", deliveryId);
    link.searchParams.set("lang", locale);
    return link.toString();
  }

  function openWhatsAppMessage() {
    const message = t.whatsAppTrackingMessage(selected.id, selected.destination, trackingUrl(selected.id));
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    setMessageEvents((events) => [
      { id: `${selected.id}-tracking-${Date.now()}`, deliveryId: selected.id, kind: "tracking", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      ...events,
    ].slice(0, 4));
    setToast(t.whatsAppOpened);
  }

  function simulateArrival() {
    if (selected.status === "Delivered") return;
    setDeliveries((items) => items.map((delivery) => delivery.id === selected.id
      ? { ...delivery, status: "Delivered", progress: 100, eta: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }
      : delivery));
    setMessageEvents((events) => [
      { id: `${selected.id}-arrival-${Date.now()}`, deliveryId: selected.id, kind: "arrival", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      ...events,
    ].slice(0, 4));
    setToast(t.arrivalSimulated(selected.id));
  }

  function openCustomerView() {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", selected.id);
    link.searchParams.set("lang", locale);
    window.history.pushState({}, "", link);
    setView("customer");
  }

  function openDispatchView() {
    const dashboardUrl = new URL(window.location.origin);
    dashboardUrl.searchParams.set("lang", locale);
    window.history.pushState({}, "", dashboardUrl);
    setView("dispatch");
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", nextUrl);
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
      setToast(t.created(data.delivery.id));
    } catch {
      setToast(t.createFailed);
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
          <div className="customer-header-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} /><div className="secure-pill"><span>●</span> {t.secureLink}</div></div>
        </header>

        <section className="customer-content">
          <div className="customer-intro">
            <div>
              <p className="eyebrow">{t.deliveryLabel} {selected.id}</p>
              <h1>{customerCopy.headline}</h1>
              <p className="customer-subtitle">{customerCopy.subtitle(selected.destination)}</p>
            </div>
            <div className="eta-card">
              <span>{t.estimatedArrival}</span>
              <strong>{selected.eta}</strong>
              <small className={`eta-${selected.status.toLowerCase().replace(" ", "-")}`}>{customerCopy.etaNote}</small>
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
              <div className="map-live"><i /> {t.liveUpdated}</div>
            </div>

            <aside className="journey-card">
              <div className="journey-title">
                <div className="mini-truck">▰</div>
                <div><strong>{selected.truck}</strong><span>{t.yourVehicle}</span></div>
              </div>
              <div className="timeline">
                <div className="timeline-step done"><i>✓</i><div><strong>{t.orderPrepared}</strong><span>{t.todayTime("08:42")}</span></div></div>
                <div className="timeline-step done"><i>✓</i><div><strong>{t.leftWarehouse}</strong><span>{t.todayTime("10:16")}</span></div></div>
                <div className={`timeline-step active ${selected.status === "Delayed" ? "is-delayed" : ""}`}><i>●</i><div><strong>{customerCopy.currentTitle}</strong><span>{customerCopy.currentDetail(selected.progress, selected.eta)}</span></div></div>
                <div className={selected.status === "Delivered" ? "timeline-step done" : "timeline-step"}><i>{selected.status === "Delivered" ? "✓" : "◆"}</i><div><strong>{customerCopy.finalTitle}</strong><span>{customerCopy.finalDetail(selected.eta)}</span></div></div>
              </div>
              <div className="privacy-note"><Icon>⌁</Icon><p><strong>{t.privacyTitle}</strong><span>{t.privacyBody}</span></p></div>
            </aside>
          </div>

          <div className="customer-footer"><span>{t.needHelp}</span><strong>{t.contactSender}</strong></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></a>
        <nav aria-label="Main navigation">
          <button className="nav-item active"><Icon>▦</Icon>{t.overview}</button>
          <button className="nav-item" disabled><Icon>▰</Icon>{t.fleet} <span className="nav-count">20</span></button>
          <button className="nav-item" disabled><Icon>◇</Icon>{t.deliveries} <span className="nav-count">18</span></button>
          <button className="nav-item" disabled><Icon>◉</Icon>{t.customers}</button>
        </nav>
        <div className="sidebar-divider" />
        <nav>
          <button className="nav-item" disabled><Icon>⚙</Icon>{t.settings}</button>
          <button className="nav-item" disabled><Icon>?</Icon>{t.helpCentre}</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="gps-card">
          <div className="gps-icon">⌖</div>
          <strong>{t.gpsActive}</strong>
          <p>{t.gpsBody}</p>
          <span className="gps-coming">{t.gpsLocked}</span>
        </div>
        <div className="profile"><div className="avatar">CM</div><div><strong>Camille Moreau</strong><span>{t.dispatcher}</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><h1>{t.greeting}</h1><p>{t.greetingSub}</p></div>
          <div className="top-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} /><button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>{t.newDelivery}</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>{t.activeDeliveries}</span><Icon>◇</Icon></div><div><strong>14</strong><em className="up">↗ 12%</em></div><p>{t.acrossVehicles}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.onTimeRate}</span><Icon>◷</Icon></div><div><strong>94.2%</strong><em className="up">↗ 2.4%</em></div><p>{t.last30Days}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.delayed}</span><Icon>△</Icon></div><div><strong>3</strong><em className="warning">{t.needsAttention}</em></div><p>{t.delayReasons}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.fleetStatus}</span><Icon>▰</Icon></div><div><strong>17 / 20</strong><em className="neutral">{t.atDepot}</em></div><p>{t.allReporting}</p></article>
        </div>

        <div className="map-panel">
          <div className="panel-header"><div><h2>{t.liveFleet}</h2><p>{t.updatesEvery30}</p></div><div className="panel-actions"><select aria-label={t.findVehicle} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.truck}</option>)}</select><button aria-pressed={showTraffic} onClick={() => setShowTraffic((value) => !value)}><Icon>☷</Icon>{showTraffic ? t.hideTraffic : t.showTraffic}</button></div></div>
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
            {showTraffic && <div className="traffic-layer" aria-label={t.showTraffic}><span>{t.moderateTraffic}</span><i /><i /><i /></div>}
            <div className="map-status"><i /> {t.vehiclesReporting}</div>
            {showPopover && <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p><strong>{selected.truck}</strong><small>{selected.driver}</small></p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
              <dl><div><dt>{t.status}</dt><dd><i />{t.statuses[selected.status]}</dd></div><div><dt>{t.delivery}</dt><dd>{selected.id}</dd></div><div><dt>{t.eta}</dt><dd>{selected.eta}</dd></div></dl>
              <div className="popover-actions"><button onClick={openCustomerView}>{t.openTracking} <span>↗</span></button><button className="copy-link" onClick={copyTrackingLink}>{t.copyLink}</button></div>
            </div>}
          </div>
          <section className="whatsapp-demo" aria-labelledby="whatsapp-demo-title">
            <div className="whatsapp-demo-intro">
              <div className="whatsapp-mark" aria-hidden="true">◔</div>
              <div><div className="demo-title-line"><h3 id="whatsapp-demo-title">{t.whatsAppDemoTitle}</h3><span>{t.demoMode}</span></div><p>{t.whatsAppDemoBody}</p></div>
            </div>
            <div className="message-timeline" aria-label={t.notificationTimeline}>
              {messageEvents.filter((event) => event.deliveryId === selected.id).length ? messageEvents.filter((event) => event.deliveryId === selected.id).slice(0, 2).map((event) => (
                <div className="message-event" key={event.id}><i className={event.kind} aria-hidden="true">✓</i><div><strong>{event.kind === "tracking" ? t.trackingMessagePrepared : t.arrivalMessageTriggered}</strong><span>{selected.id} · {event.time}</span></div></div>
              )) : <div className="message-empty"><i>1</i><span>{t.noMessagesYet}</span></div>}
            </div>
            <div className="whatsapp-actions">
              <button className="whatsapp-button" onClick={openWhatsAppMessage}><span aria-hidden="true">◔</span>{t.sendWithWhatsApp}</button>
              <button className="arrival-button" onClick={simulateArrival} disabled={selected.status === "Delivered"}><span aria-hidden="true">⌖</span>{selected.status === "Delivered" ? t.arrivalAlreadySent : t.simulateArrival}</button>
            </div>
          </section>
        </div>

        <div className="deliveries-panel">
          <div className="panel-header delivery-head"><div><h2>{t.todaysDeliveries}</h2><p>{t.shownCompleted(visibleDeliveries.length, deliveries.filter((delivery) => delivery.status === "Delivered").length)}</p></div><div className="panel-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.filterDeliveries}><option value="All deliveries">{t.allDeliveries}</option><option value="In transit">{t.statuses["In transit"]}</option><option value="Delayed">{t.statuses.Delayed}</option><option value="Loading">{t.statuses.Loading}</option><option value="Delivered">{t.statuses.Delivered}</option></select></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.tableDelivery}</th><th>{t.tableCustomer}</th><th>{t.tableVehicle}</th><th>{t.tableStatus}</th><th>{t.tableEta}</th><th>{t.tableProgress}</th><th><span className="sr-only">{t.tableActions}</span></th></tr></thead>
              <tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{delivery.id}</strong><span>{delivery.destination}</span></td><td><div className="customer-cell"><i style={{ background: delivery.color }}>{delivery.customer.split(" ").map((word) => word[0]).slice(0,2).join("")}</i><span>{delivery.customer}</span></div></td><td><strong>{delivery.truck}</strong><span>{delivery.driver}</span></td><td><span className={statusClass[delivery.status]}><i />{t.statuses[delivery.status]}</span></td><td><strong>{delivery.eta}</strong><span>{delivery.status === "Delayed" ? t.updated : delivery.status === "Delivered" ? t.arrived : t.today}</span></td><td><div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div></td><td><button className="more-button" aria-label={t.copyTrackingFor(delivery.id)} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">{t.createEyebrow}</p><h2 id="new-delivery-title">{t.createTitle}</h2><span>{t.createHelp}</span></div><button onClick={() => setModalOpen(false)} aria-label={t.close}>×</button></div><form onSubmit={createDelivery}><label>{t.customerCompany}<input name="customer" required autoFocus placeholder={t.customerPlaceholder} /></label><label>{t.destination}<input name="destination" required placeholder={t.destinationPlaceholder} /></label><div className="form-row"><label>{t.assignTruck}<select name="truck" defaultValue="TRK-005"><option>TRK-005</option><option>TRK-008</option><option>TRK-012</option><option>TRK-017</option></select></label><label>{t.expectedArrival}<input name="eta" required type="time" defaultValue="15:30" /></label></div><label>{t.customerContact} <span>({t.optional})</span><input name="contact" placeholder={t.contactPlaceholder} /></label><div className="modal-footer"><button type="button" onClick={() => setModalOpen(false)}>{t.cancel}</button><button className="primary-button" type="submit" disabled={creating}>{creating ? t.creating : t.createDelivery}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
}
