"use client";

import { useEffect, useState } from "react";

export default function AgencyEnrollmentPage() {
  const [state, setState] = useState<"loading" | "error">("loading");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState({}, "", "/agency/enroll");
    if (!token) {
      queueMicrotask(() => setState("error"));
      return;
    }
    void fetch("/api/auth/agency-enrollment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then((response) => {
      if (!response.ok) throw new Error("enrollment_failed");
      window.location.replace("/");
    }).catch(() => setState("error"));
  }, []);

  return <main className="login-page login-loading">
    <section className="tracking-error">
      <div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div>
      {state === "loading"
        ? <><h1>Activation de l’agence…</h1><p>Connexion sécurisée de cet appareil à TrackFleet.</p></>
        : <><h1>Lien invalide ou expiré</h1><p>Demandez un nouveau lien d’activation à l’administrateur TrackFleet.</p></>}
    </section>
  </main>;
}
