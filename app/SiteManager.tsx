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

export default function SiteManager({ locale }: { locale: "fr" | "en" | "nl" }) {
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/sites", { cache: "no-store" });
    if (!response.ok) throw new Error("sites_unavailable");
    const data = await response.json() as { sites: Site[] };
    setSites(data.sites ?? []);
  }

  useEffect(() => {
    if (open) void refresh().catch(() => setError("sites_unavailable"));
  }, [open]);

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
      setSaving(false);
    } catch {
      setError("save_failed");
      setSaving(false);
    }
  }

  const copy = locale === "fr"
    ? { button: "Agences", title: "Agences et dépôts", add: "Ajouter un site", label: "Nom", city: "Ville", address: "Adresse", country: "Pays", lat: "Latitude (optionnel)", lon: "Longitude (optionnel)", radius: "Rayon arrivée (km)", save: "Enregistrer", saving: "Enregistrement…", error: "Impossible d’enregistrer ce site." }
    : locale === "nl"
      ? { button: "Locaties", title: "Agentschappen en depots", add: "Locatie toevoegen", label: "Naam", city: "Stad", address: "Adres", country: "Land", lat: "Breedtegraad (optioneel)", lon: "Lengtegraad (optioneel)", radius: "Aankomstradius (km)", save: "Opslaan", saving: "Opslaan…", error: "Locatie kon niet worden opgeslagen." }
      : { button: "Sites", title: "Agencies and depots", add: "Add site", label: "Name", city: "City", address: "Address", country: "Country", lat: "Latitude (optional)", lon: "Longitude (optional)", radius: "Arrival radius (km)", save: "Save", saving: "Saving…", error: "Could not save this site." };

  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}>⌖ {copy.button}</button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="eyebrow">TRACKFLEET</p><h2>{copy.title}</h2><span>{sites.length} sites</span></div><button onClick={() => setOpen(false)} aria-label="Close">×</button></div>
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
          <div className="modal-footer"><button type="button" onClick={() => setOpen(false)}>×</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.save}</button></div>
        </form>
      </section>
    </div>}
  </>;
}
