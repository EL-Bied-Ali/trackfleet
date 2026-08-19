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

type ManualDelivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  status: string;
  progress: number;
};

export default function SiteManager({ locale }: { locale: "fr" | "en" | "nl" }) {
  const [open, setOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [consents, setConsents] = useState<ConsentDelivery[]>([]);
  const [manualDeliveries, setManualDeliveries] = useState<ManualDelivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [completionBusy, setCompletionBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [completionError, setCompletionError] = useState("");

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

  async function refreshManualCompletions() {
    const response = await fetch("/api/deliveries/manual-completion", { cache: "no-store" });
    if (!response.ok) throw new Error("completion_unavailable");
    const data = await response.json() as { deliveries: ManualDelivery[] };
    setManualDeliveries(data.deliveries ?? []);
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

  useEffect(() => {
    if (!completionOpen) return;
    queueMicrotask(() => {
      void refreshManualCompletions().catch(() => setCompletionError("completion_unavailable"));
    });
  }, [completionOpen]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      id: editingSite?.id,
      label: String(form.get("label") ?? ""),
      city: String(form.get("city") ?? ""),
      address: String(form.get("address") ?? ""),
      country: String(form.get("country") ?? "MA"),
      latitude: String(form.get("latitude") ?? "").trim() || null,
      longitude: String(form.get("longitude") ?? "").trim() || null,
      arrivalRadiusKm: Number(form.get("arrivalRadiusKm") ?? 0.5),
      roles: editingSite?.roles ?? ["origin", "dropoff", "replenishment", "destination"],
    };
    try {
      const response = await fetch("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("save_failed");
      await refresh();
      setEditingSite(null);
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

  async function completeManually(delivery: ManualDelivery) {
    const confirmation = locale === "fr"
      ? `Confirmer que ${delivery.id} a réellement été livré ?`
      : locale === "nl"
        ? `Bevestigen dat ${delivery.id} werkelijk is geleverd?`
        : `Confirm that ${delivery.id} was physically delivered?`;
    if (!window.confirm(confirmation)) return;
    setCompletionBusy(delivery.id);
    setCompletionError("");
    try {
      const response = await fetch("/api/deliveries/manual-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: delivery.id, confirmDelivered: true }),
      });
      if (!response.ok) throw new Error("completion_failed");
      setManualDeliveries((items) => items.filter((item) => item.id !== delivery.id));
      window.location.reload();
    } catch {
      setCompletionError("completion_failed");
    } finally {
      setCompletionBusy(null);
    }
  }

  const copy = locale === "fr"
    ? {
        button: "Agences", title: "Agences et dépôts", count: (value: number) => `${value} site${value > 1 ? "s" : ""}`,
        add: "Ajouter un site", editTitle: "Modifier le site", edit: "Modifier", cancelEdit: "Annuler", update: "Mettre à jour", gpsReady: "GPS configuré", gpsMissing: "Coordonnées GPS manquantes", label: "Nom", city: "Ville", address: "Adresse", country: "Pays", lat: "Latitude (optionnel)", lon: "Longitude (optionnel)", radius: "Rayon d’arrivée (km)", save: "Enregistrer", saving: "Enregistrement…", close: "Fermer", error: "Impossible d’enregistrer ce site.",
        consentButton: "WhatsApp", consentTitle: "Consentements WhatsApp", consentIntro: "Retirez ici l’autorisation d’un client. Après retrait, TrackFleet n’enverra plus aucune mise à jour automatique pour ce colis.", active: "Actif", withdrawn: "Retiré", withdraw: "Retirer le consentement", withdrawing: "Retrait…", noConsents: "Aucun consentement WhatsApp enregistré.", consentError: "Impossible de mettre à jour le consentement.",
        completionButton: "Clôture", completionTitle: "Clôture manuelle", completionIntro: "À utiliser seulement si le GPS ou SENDATRACK ne peut pas confirmer la fin du déchargement. L’action marque définitivement le colis comme livré.", complete: "Marquer livré", completing: "Clôture…", noActive: "Aucune livraison active.", completionError: "Impossible de clôturer cette livraison.",
      }
    : locale === "nl"
      ? {
          button: "Locaties", title: "Agentschappen en depots", count: (value: number) => `${value} locatie${value === 1 ? "" : "s"}`,
          add: "Locatie toevoegen", editTitle: "Locatie bewerken", edit: "Bewerken", cancelEdit: "Annuleren", update: "Bijwerken", gpsReady: "GPS ingesteld", gpsMissing: "GPS-coördinaten ontbreken", label: "Naam", city: "Stad", address: "Adres", country: "Land", lat: "Breedtegraad (optioneel)", lon: "Lengtegraad (optioneel)", radius: "Aankomstradius (km)", save: "Opslaan", saving: "Opslaan…", close: "Sluiten", error: "Locatie kon niet worden opgeslagen.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp-toestemmingen", consentIntro: "Trek hier de toestemming van een klant in. Daarna verstuurt TrackFleet geen automatische updates meer voor deze levering.", active: "Actief", withdrawn: "Ingetrokken", withdraw: "Toestemming intrekken", withdrawing: "Intrekken…", noConsents: "Geen WhatsApp-toestemmingen geregistreerd.", consentError: "Toestemming kon niet worden bijgewerkt.",
          completionButton: "Afsluiten", completionTitle: "Handmatig afsluiten", completionIntro: "Alleen gebruiken wanneer GPS of SENDATRACK het einde van het lossen niet kan bevestigen. Deze actie markeert de zending definitief als geleverd.", complete: "Markeer geleverd", completing: "Afsluiten…", noActive: "Geen actieve leveringen.", completionError: "Deze levering kon niet worden afgesloten.",
        }
      : {
          button: "Sites", title: "Agencies and depots", count: (value: number) => `${value} site${value === 1 ? "" : "s"}`,
          add: "Add site", editTitle: "Edit site", edit: "Edit", cancelEdit: "Cancel", update: "Update", gpsReady: "GPS configured", gpsMissing: "GPS coordinates missing", label: "Name", city: "City", address: "Address", country: "Country", lat: "Latitude (optional)", lon: "Longitude (optional)", radius: "Arrival radius (km)", save: "Save", saving: "Saving…", close: "Close", error: "Could not save this site.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp consents", consentIntro: "Withdraw a customer’s permission here. TrackFleet will stop all automatic WhatsApp updates for that delivery.", active: "Active", withdrawn: "Withdrawn", withdraw: "Withdraw consent", withdrawing: "Withdrawing…", noConsents: "No WhatsApp consent recorded.", consentError: "Could not update consent.",
          completionButton: "Complete", completionTitle: "Manual completion", completionIntro: "Use only when GPS or SENDATRACK cannot confirm the end of unloading. This action permanently marks the delivery as delivered.", complete: "Mark delivered", completing: "Completing…", noActive: "No active deliveries.", completionError: "Could not complete this delivery.",
        };

  const consentRows = consents.filter((item) => item.whatsappOptIn || item.withdrawn);

  return <>
    <button className="secondary-button" type="button" onClick={() => { setEditingSite(null); setOpen(true); }}><span aria-hidden="true">▦</span> {copy.button}</button>
    <button className="secondary-button" type="button" onClick={() => setConsentOpen(true)}><span aria-hidden="true">◔</span> {copy.consentButton}</button>
    <button className="secondary-button" type="button" onClick={() => setCompletionOpen(true)}><span aria-hidden="true">✓</span> {copy.completionButton}</button>

    {open && <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="sites-title">
        <div className="modal-header"><div><p className="eyebrow">TRACKFLEET</p><h2 id="sites-title">{copy.title}</h2><span>{copy.count(sites.length)}</span></div><button onClick={() => { setEditingSite(null); setOpen(false); }} aria-label={copy.close}>×</button></div>
        <div style={{ maxHeight: 220, overflow: "auto", marginBottom: 16 }}>
          {sites.map((site) => {
            const gpsReady = typeof site.latitude === "number" && typeof site.longitude === "number";
            return <div key={site.id} style={{ padding: "9px 0", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
              <div><strong>{site.label}</strong><div style={{ fontSize: 12, opacity: .7 }}>{site.address}</div><div style={{ fontSize: 12, marginTop: 3 }}>{gpsReady ? copy.gpsReady : copy.gpsMissing}</div></div>
              <button type="button" onClick={() => { setError(""); setEditingSite(site); }}>{copy.edit}</button>
            </div>;
          })}
        </div>
        <form key={editingSite?.id ?? "new-site"} onSubmit={save}>
          <h3 style={{ marginBottom: 12 }}>{editingSite ? copy.editTitle : copy.add}</h3>
          <div className="form-row"><label>{copy.label}<input name="label" required defaultValue={editingSite?.label ?? ""} /></label><label>{copy.city}<input name="city" required defaultValue={editingSite?.city ?? ""} /></label></div>
          <label>{copy.address}<input name="address" required defaultValue={editingSite?.address ?? ""} /></label>
          <div className="form-row"><label>{copy.country}<select name="country" defaultValue={editingSite?.country ?? "MA"}><option value="MA">Maroc</option><option value="BE">Belgique</option></select></label><label>{copy.radius}<input name="arrivalRadiusKm" type="number" min="0.05" max="10" step="0.05" defaultValue={editingSite?.arrivalRadiusKm ?? 0.5} /></label></div>
          <div className="form-row"><label>{copy.lat}<input name="latitude" type="number" step="any" defaultValue={editingSite?.latitude ?? ""} /></label><label>{copy.lon}<input name="longitude" type="number" step="any" defaultValue={editingSite?.longitude ?? ""} /></label></div>
          {error && <p className="login-error">{copy.error}</p>}
          <div className="modal-footer">
            {editingSite && <button type="button" onClick={() => { setError(""); setEditingSite(null); }}>{copy.cancelEdit}</button>}
            <button type="button" onClick={() => { setEditingSite(null); setOpen(false); }}>{copy.close}</button>
            <button className="primary-button" disabled={saving}>{saving ? copy.saving : editingSite ? copy.update : copy.save}</button>
          </div>
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

    {completionOpen && <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="completion-title">
        <div className="modal-header"><div><p className="eyebrow">TRACKFLEET · OPS</p><h2 id="completion-title">{copy.completionTitle}</h2><span>{copy.completionIntro}</span></div><button onClick={() => setCompletionOpen(false)} aria-label={copy.close}>×</button></div>
        <div className="consent-list">
          {manualDeliveries.length === 0 ? <p className="consent-empty">{copy.noActive}</p> : manualDeliveries.map((delivery) => <div className="consent-row" key={delivery.id}>
            <div><strong>{delivery.customer}</strong><span>{delivery.id} · {delivery.destination} · {delivery.truck}</span></div>
            <span className="consent-status active">{delivery.progress}%</span>
            <button type="button" className="danger-button" disabled={completionBusy === delivery.id} onClick={() => void completeManually(delivery)}>{completionBusy === delivery.id ? copy.completing : copy.complete}</button>
          </div>)}
        </div>
        {completionError && <p className="login-error">{copy.completionError}</p>}
        <div className="modal-footer"><button type="button" onClick={() => setCompletionOpen(false)}>{copy.close}</button></div>
      </section>
    </div>}
  </>;
}
