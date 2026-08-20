"use client";

import { useEffect, useState } from "react";
import { isUnassignedVehicle } from "./lib/delivery-vehicle-choice";

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
  arrivalState: "automatic_pending" | "manual_recommended" | "automatic_confirmed" | "manual_confirmed";
  arrivalReason: "in_transit" | "destination_coordinates_missing" | "gps_unavailable" | "gps_stale" | "gps_arrival_detected" | "manual_already_confirmed";
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
  const [arrivalBusy, setArrivalBusy] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState("");
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

  async function confirmArrival(delivery: ManualDelivery) {
    const confirmation = locale === "fr"
      ? `Confirmer que le camion de ${delivery.id} est physiquement arrivé à ${delivery.destination} ?`
      : locale === "nl"
        ? `Bevestigen dat de vrachtwagen voor ${delivery.id} fysiek is aangekomen in ${delivery.destination}?`
        : `Confirm that the truck for ${delivery.id} has physically arrived at ${delivery.destination}?`;
    if (!window.confirm(confirmation)) return;
    setArrivalBusy(delivery.id);
    setCompletionError("");
    try {
      const response = await fetch("/api/deliveries/manual-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: delivery.id, confirmArrival: true }),
      });
      if (!response.ok) throw new Error("arrival_failed");
      setManualDeliveries((items) => items.map((item) => item.id === delivery.id
        ? { ...item, arrivalState: "manual_confirmed", arrivalReason: "manual_already_confirmed" }
        : item));
    } catch {
      setCompletionError("arrival_failed");
    } finally {
      setArrivalBusy(null);
    }
  }

  async function createAgencyAccess(site: Site) {
    setAccessBusy(site.id);
    setAccessMessage("");
    try {
      const response = await fetch("/api/auth/agency-enrollment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: site.id }),
      });
      const data = await response.json() as { enrollmentUrl?: string };
      if (!response.ok || !data.enrollmentUrl) throw new Error("access_failed");
      try {
        await navigator.clipboard.writeText(data.enrollmentUrl);
        setAccessMessage(copy.accessCopied(site.label));
      } catch {
        window.prompt(copy.accessCopyFallback, data.enrollmentUrl);
      }
    } catch {
      setAccessMessage(copy.accessError);
    } finally {
      setAccessBusy(null);
    }
  }

  const copy = locale === "fr"
    ? {
        button: "Agences", title: "Agences et dépôts", count: (value: number) => `${value} site${value > 1 ? "s" : ""}`,
        add: "Ajouter un site", editTitle: "Modifier le site", edit: "Modifier", agencyAccess: "Accès agence", creatingAccess: "Création…", accessCopied: (label: string) => `Lien temporaire copié pour ${label}. Il expire dans 30 minutes.`, accessCopyFallback: "Copiez ce lien d’activation agence", accessError: "Impossible de créer l’accès agence.", cancelEdit: "Annuler", update: "Mettre à jour", gpsReady: "GPS configuré", gpsMissing: "Coordonnées GPS manquantes", label: "Nom", city: "Ville", address: "Adresse", country: "Pays", lat: "Latitude (optionnel)", lon: "Longitude (optionnel)", radius: "Rayon d’arrivée (km)", save: "Enregistrer", saving: "Enregistrement…", close: "Fermer", error: "Impossible d’enregistrer ce site.",
        consentButton: "WhatsApp", consentTitle: "Consentements WhatsApp", consentIntro: "Retirez ici l’autorisation d’un client. Après retrait, TrackFleet n’enverra plus aucune mise à jour automatique pour ce colis.", active: "Actif", withdrawn: "Retiré", withdraw: "Retirer le consentement", withdrawing: "Retrait…", noConsents: "Aucun consentement WhatsApp enregistré.", consentError: "Impossible de mettre à jour le consentement.",
        completionButton: "Arrivées", completionTitle: "Arrivées et clôture", completionIntro: "TrackFleet détecte l’arrivée automatiquement. Confirmez-la seulement quand le camion est bien sur place et que le GPS ne suffit pas; le délai de déchargement puis la clôture automatique continueront.", complete: "Marquer livré", completing: "Clôture…", confirmArrival: "Confirmer l’arrivée", confirmingArrival: "Confirmation…", automaticPending: "Détection automatique active", manualRecommended: "Confirmation recommandée", automaticConfirmed: "Arrivée détectée automatiquement", manualConfirmed: "Arrivée confirmée par un employé", unassigned: "Camion à affecter", noActive: "Aucune livraison active.", completionError: "Impossible de mettre à jour cette livraison.",
      }
    : locale === "nl"
      ? {
          button: "Locaties", title: "Agentschappen en depots", count: (value: number) => `${value} locatie${value === 1 ? "" : "s"}`,
          add: "Locatie toevoegen", editTitle: "Locatie bewerken", edit: "Bewerken", agencyAccess: "Agentschapstoegang", creatingAccess: "Aanmaken…", accessCopied: (label: string) => `Tijdelijke link gekopieerd voor ${label}. Deze verloopt over 30 minuten.`, accessCopyFallback: "Kopieer deze activeringslink", accessError: "Agentschapstoegang kon niet worden aangemaakt.", cancelEdit: "Annuleren", update: "Bijwerken", gpsReady: "GPS ingesteld", gpsMissing: "GPS-coördinaten ontbreken", label: "Naam", city: "Stad", address: "Adres", country: "Land", lat: "Breedtegraad (optioneel)", lon: "Lengtegraad (optioneel)", radius: "Aankomstradius (km)", save: "Opslaan", saving: "Opslaan…", close: "Sluiten", error: "Locatie kon niet worden opgeslagen.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp-toestemmingen", consentIntro: "Trek hier de toestemming van een klant in. Daarna verstuurt TrackFleet geen automatische updates meer voor deze levering.", active: "Actief", withdrawn: "Ingetrokken", withdraw: "Toestemming intrekken", withdrawing: "Intrekken…", noConsents: "Geen WhatsApp-toestemmingen geregistreerd.", consentError: "Toestemming kon niet worden bijgewerkt.",
          completionButton: "Aankomsten", completionTitle: "Aankomsten en afsluiting", completionIntro: "TrackFleet detecteert aankomst automatisch. Bevestig alleen wanneer de vrachtwagen ter plaatse is en GPS onvoldoende is; de lostijd en automatische afsluiting gaan daarna door.", complete: "Markeer geleverd", completing: "Afsluiten…", confirmArrival: "Aankomst bevestigen", confirmingArrival: "Bevestigen…", automaticPending: "Automatische detectie actief", manualRecommended: "Bevestiging aanbevolen", automaticConfirmed: "Aankomst automatisch gedetecteerd", manualConfirmed: "Aankomst bevestigd door medewerker", unassigned: "Voertuig nog toewijzen", noActive: "Geen actieve leveringen.", completionError: "Deze levering kon niet worden bijgewerkt.",
        }
      : {
          button: "Sites", title: "Agencies and depots", count: (value: number) => `${value} site${value === 1 ? "" : "s"}`,
          add: "Add site", editTitle: "Edit site", edit: "Edit", agencyAccess: "Agency access", creatingAccess: "Creating…", accessCopied: (label: string) => `Temporary link copied for ${label}. It expires in 30 minutes.`, accessCopyFallback: "Copy this agency activation link", accessError: "Could not create agency access.", cancelEdit: "Cancel", update: "Update", gpsReady: "GPS configured", gpsMissing: "GPS coordinates missing", label: "Name", city: "City", address: "Address", country: "Country", lat: "Latitude (optional)", lon: "Longitude (optional)", radius: "Arrival radius (km)", save: "Save", saving: "Saving…", close: "Close", error: "Could not save this site.",
          consentButton: "WhatsApp", consentTitle: "WhatsApp consents", consentIntro: "Withdraw a customer’s permission here. TrackFleet will stop all automatic WhatsApp updates for that delivery.", active: "Active", withdrawn: "Withdrawn", withdraw: "Withdraw consent", withdrawing: "Withdrawing…", noConsents: "No WhatsApp consent recorded.", consentError: "Could not update consent.",
          completionButton: "Arrivals", completionTitle: "Arrivals and completion", completionIntro: "TrackFleet detects arrival automatically. Confirm only when the truck is physically present and GPS is insufficient; unloading grace and automatic completion will then continue.", complete: "Mark delivered", completing: "Completing…", confirmArrival: "Confirm arrival", confirmingArrival: "Confirming…", automaticPending: "Automatic detection active", manualRecommended: "Confirmation recommended", automaticConfirmed: "Arrival detected automatically", manualConfirmed: "Arrival confirmed by employee", unassigned: "Truck awaiting assignment", noActive: "No active deliveries.", completionError: "Could not update this delivery.",
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
              <div style={{ display: "flex", gap: 8 }}><button type="button" disabled={accessBusy === site.id} onClick={() => void createAgencyAccess(site)}>{accessBusy === site.id ? copy.creatingAccess : copy.agencyAccess}</button><button type="button" onClick={() => { setError(""); setEditingSite(site); }}>{copy.edit}</button></div>
            </div>;
          })}
        </div>
        {accessMessage && <p className="agency-location-message" role="status">{accessMessage}</p>}
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
          {manualDeliveries.length === 0 ? <p className="consent-empty">{copy.noActive}</p> : manualDeliveries.map((delivery) => {
            const arrivalConfirmed = delivery.arrivalState === "automatic_confirmed" || delivery.arrivalState === "manual_confirmed";
            const unassigned = isUnassignedVehicle({ truck: delivery.truck });
            const truckLabel = unassigned ? copy.unassigned : delivery.truck;
            const arrivalLabel = unassigned
              ? copy.unassigned
              : delivery.arrivalState === "manual_recommended"
              ? copy.manualRecommended
              : delivery.arrivalState === "automatic_confirmed"
                ? copy.automaticConfirmed
                : delivery.arrivalState === "manual_confirmed"
                  ? copy.manualConfirmed
                  : copy.automaticPending;
            return <div className="consent-row" key={delivery.id}>
              <div><strong>{delivery.customer}</strong><span>{delivery.id} · {delivery.destination} · {truckLabel}</span><span>{arrivalLabel}</span></div>
              <span className="consent-status active">{delivery.progress}%</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {!unassigned && !arrivalConfirmed && <button type="button" className={delivery.arrivalState === "manual_recommended" ? "primary-button" : undefined} disabled={arrivalBusy === delivery.id} onClick={() => void confirmArrival(delivery)}>{arrivalBusy === delivery.id ? copy.confirmingArrival : copy.confirmArrival}</button>}
                {arrivalConfirmed && <button type="button" className="danger-button" disabled={completionBusy === delivery.id} onClick={() => void completeManually(delivery)}>{completionBusy === delivery.id ? copy.completing : copy.complete}</button>}
              </div>
            </div>;
          })}
        </div>
        {completionError && <p className="login-error">{copy.completionError}</p>}
        <div className="modal-footer"><button type="button" onClick={() => setCompletionOpen(false)}>{copy.close}</button></div>
      </section>
    </div>}
  </>;
}
