"use client";

import { useEffect, useState } from "react";

type Site = {
  id: string;
  label: string;
  city: string;
  address: string;
  country: "BE" | "MA";
  roles: Array<"origin" | "dropoff" | "replenishment" | "destination">;
  latitude: number | null;
  longitude: number | null;
  arrivalRadiusKm: number;
};

type ConsentDelivery = {
  deliveryId: string;
  customer: string;
  contact: string;
  optedInAt: string | null;
  whatsappOptIn: boolean;
  withdrawn: boolean;
  status: string;
};

export default function SiteManager({ locale }: { locale: "fr" | "en" | "nl" }) {
  const [open, setOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [consents, setConsents] = useState<ConsentDelivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [consentError, setConsentError] = useState("");

  async function refresh() {
    const response = await fetch("/api/sites", { cache: "no-store" });
    if (!response.ok) throw new Error("sites_unavailable");
    const data = await response.json() as { sites: Site[] };
    setSites(data.sites ?? []);
  }

  async function refreshConsents() {
    const response = await fetch("/api/deliveries/whatsapp-consent", { cache: "no-store" });
    if (!response.ok) throw new Error("consent_unavailable");
    const data = await response.json() as { deliveries: ConsentDelivery[] };
    setConsents(data.deliveries ?? []);
  }

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      void refresh().catch(() => setError("sites_unavailable"));
    });
  }, [open]);

  useEffect(() => {
    if (!consentOpen) return;
    queueMicrotask(() => {
      void refreshConsents().catch(() => setConsentError("consent_unavailable"));
    });
  }, [consentOpen]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      label: String(form.get("label") ?? ""),
      city: String(form.get("city") ?? ""),
      address: String(form.get("address") ?? ""),
      country: String(form.get("country") ?? "MA"),
      latitude: String(form.get("latitude") ?? "").trim() || null,
      longitude: String(form.get("longitude") ?? "").trim() || null,
      arrivalRadiusKm: Number(form.get("arrivalRadiusKm") ?? 0.5),
      roles: ["origin", "dropoff", "replenishment", "destination"],
    };
    try {
      const response = await fetch("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("save_failed");
      await refresh();
      formElement.reset();
      window.dispatchEvent(new Event("trackfleet-sites-changed"));
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawConsent(deliveryId: string) {
    setConsentBusy(deliveryId);
    setConsentError("");
    try {
      const response = await fetch("/api/deliveries/whatsapp-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId }),
      });
      if (!response.ok) throw new Error("withdraw_failed");
      setConsents((items) => items.map((item) => item.deliveryId === deliveryId ? { ...item, whatsappOptIn: false, withdrawn: true } : item));
    } catch {
      setConsentError("withdraw_failed");
    } finally {
      setConsentBusy(null);
    }
  }

  const copy = locale === "fr"
    ? {
        button: "Agences", title: "Agences et dépôts", count: (value: number) => `${value} site${value > 1 ? "s" : ""}`,
        add: "Ajouter un site", label: "Nom", city: "Ville", address: "Adresse", country: "Pays", lat: "Latitude (optionnel)", lon: "Longitude (optionnel)", radius: "Rayon d’arrivée (km)", save: "Enregistrer", saving: "Enregistrement…", close: "Fermer", error: "Impossible d’enregistrer ce site.",
        consentButton: "WhatsApp", consentTitle: "Consentements WhatsApp", consentIntro: "Retirez ici l’autorisation d’un client. Après retrait, TrackFleet n’enverra plus aucune mise à jour automatique pour ce colis.", active: "Actif", withdrawn: "Retiré", withdraw: "Retirer le consentement", withdrawing: "Retrait…", noConsents: "Aucun consentement WhatsApp enregistré.", consentError: "Impossible de mettre à jour le consentement.",
      }
    : locale === "nl"
      ? {
          button: "Locaties", title: "Agentschappen en depots", count: (value: number) => `${value} locatie${value === 1 ? "" : "s"}`,
          add: "Locatie toevoegen", label: "Naam", city: "Stad", address: "Adres", country: "Land", lat: "Breedtegraad (optioneel)", lon: "Lengtegraad (optioneel)", radius: "Aankomstradius (km)", save: "Opslaan", saving: "Opslaan…", close: "Sluiten", error: "Locatie kon niet worden opgeslagen.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp-toestemmingen", consentIntro: "Trek hier de toestemming van een klant in. Daarna verstuurt TrackFleet geen automatische updates meer voor deze levering.", active: "Actief", withdrawn: "Ingetrokken", withdraw: "Toestemming intrekken", withdrawing: "Intrekken…", noConsents: "Geen WhatsApp-toestemmingen geregistreerd.", consentError: "Toestemming kon niet worden bijgewerkt.",
        }
      : {
          button: "Sites", title: "Agencies and depots", count: (value: number) => `${value} site${value === 1 ? "" : "s"}`,
          add: "Add site", label: "Name", city: "City", address: "Address", country: "Country", lat: "Latitude (optional)", lon: "Longitude (optional)", radius: "Arrival radius (km)", save: "Save", saving: "Saving…", close: "Close", error: "Could not save this site.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp consents", consentIntro: "Withdraw a customer’s permission here. TrackFleet will stop all automatic WhatsApp updates for that delivery.", active: "Active", withdrawn: "Withdrawn", withdraw: "Withdraw consent", withdrawing: "Withdrawing…", noConsents: "No WhatsApp consent recorded.", consentError: "Could not update consent.",
        };

  const consentRows = consents.filter((item) => item.whatsappOptIn || item.withdrawn);

  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}><span aria-hidden="true">▦</span> {copy.button}</button>
    <button className="secondary-button" type="button" onClick={() => setConsentOpen(true)}><span aria-hidden="true">◔</span> {copy.consentButton}</button>

    {open && <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="sites-title">
        <div className="modal-header"><div><p className="eyebrow">TRACKFLEET</p><h2 id="sites-title">{copy.title}</h2><span>{copy.count(sites.length)}</span></div><button onClick={() => setOpen(false)} aria-label={copy.close}>×</button></div>
        <div style={{ maxHeight: 220, overflow: "auto", marginBottom: 16 }}>
          {sites.map((site) => <div key={site.id} style={{ padding: "9px 0", borderBottom: "1px solid #e5e7eb" }}><strong>{site.label}</strong><div style={{ fontSize: 12, opacity: .7 }}>{site.address}</div></div>)}
        </div>
        <form onSubmit={save}>
          <h3 style={{ marginBottom: 12 }}>{copy.add}</h3>
          <div className="form-row"><label>{copy.label}<input name="label" required /></label><label>{copy.city}<input name="city" required /></label></div>
          <label>{copy.address}<input name="address" required /></label>
          <div className="form-row"><label>{copy.country}<select name="country" defaultValue="MA"><option value="MA">Maroc</option><option value="BE">Belgique</option></select></label><label>{copy.radius}<input name="arrivalRadiusKm" type="number" min="0.05" max="10" step="0.05" defaultValue="0.5" /></label></div>
          <div className="form-row"><label>{copy.lat}<input name="latitude" type="number" step="any" /></label><label>{copy.lon}<input name="longitude" type="number" step="any" /></label></div>
          {error && <p className="login-error">{copy.error}</p>}
          <div className="modal-footer"><button type="button" onClick={() => setOpen(false)}>{copy.close}</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.save}</button></div>
        </form>
      </section>
    </div>}

    {consentOpen && <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div className="modal-header"><div><p className="eyebrow">TRACKFLEET · WHATSAPP</p><h2 id="consent-title">{copy.consentTitle}</h2><span>{copy.consentIntro}</span></div><button onClick={() => setConsentOpen(false)} aria-label={copy.close}>×</button></div>
        <div className="consent-list">
          {consentRows.length === 0 ? <p className="consent-empty">{copy.noConsents}</p> : consentRows.map((item) => <div className="consent-row" key={item.deliveryId}>
            <div><strong>{item.customer}</strong><span>{item.deliveryId} · {item.contact || "—"}</span></div>
            <span className={`consent-status ${item.whatsappOptIn ? "active" : "withdrawn"}`}>{item.whatsappOptIn ? copy.active : copy.withdrawn}</span>
            {item.whatsappOptIn ? <button type="button" className="danger-button" disabled={consentBusy === item.deliveryId} onClick={() => void withdrawConsent(item.deliveryId)}>{consentBusy === item.deliveryId ? copy.withdrawing : copy.withdraw}</button> : <span />}
          </div>)}
        </div>
        {consentError && <p className="login-error">{copy.consentError}</p>}
        <div className="modal-footer"><button type="button" onClick={() => setConsentOpen(false)}>{copy.close}</button></div>
      </section>
    </div>}
  </>;
}
