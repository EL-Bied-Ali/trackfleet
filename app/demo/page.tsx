"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import InteractiveFleetMap from "../InteractiveFleetMap";
import styles from "./demo.module.css";

type DemoDelivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  driver: string;
  status: "In transit" | "Delayed" | "Loading" | "Delivered";
  eta: string;
  progress: number;
  latitude: number;
  longitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  sendatrackVehicleId?: string;
  speed: number;
  etaConfidence: "low" | "medium";
  etaSource: string;
};

const deliveries: DemoDelivery[] = [
  { id:"TF-2841", customer:"Atlas Distribution", destination:"Casablanca, MA", truck:"TR-17 · Mercedes Actros", driver:"Youssef B.", status:"In transit", eta:"Demain · 14:20", progress:72, latitude:35.92, longitude:-5.55, destinationLatitude:33.5731, destinationLongitude:-7.5898, sendatrackVehicleId:"demo-17", speed:74, etaConfidence:"medium", etaSource:"Historique de route + allure observée" },
  { id:"TF-2839", customer:"Maghreb Parts", destination:"Tanger, MA", truck:"TR-08 · Volvo FH", driver:"Karim S.", status:"Delayed", eta:"Demain · 10:45", progress:54, latitude:40.4168, longitude:-3.7038, destinationLatitude:35.7595, destinationLongitude:-5.834, sendatrackVehicleId:"demo-08", speed:61, etaConfidence:"medium", etaSource:"Historique de route" },
  { id:"TF-2837", customer:"EuroMed Textile", destination:"Rabat, MA", truck:"TR-22 · DAF XF", driver:"Amine R.", status:"In transit", eta:"Mercredi · 08:30", progress:31, latitude:44.8378, longitude:-0.5792, destinationLatitude:34.0209, destinationLongitude:-6.8416, sendatrackVehicleId:"demo-22", speed:82, etaConfidence:"low", etaSource:"Modèle de base" },
  { id:"TF-2835", customer:"Casa Market", destination:"Bruxelles, BE", truck:"TR-03 · Scania R", driver:"Nabil E.", status:"Loading", eta:"Jeudi · 17:10", progress:4, latitude:33.5731, longitude:-7.5898, destinationLatitude:50.8503, destinationLongitude:4.3517, sendatrackVehicleId:"demo-03", speed:0, etaConfidence:"low", etaSource:"Planification initiale" },
];

const statusLabel: Record<DemoDelivery["status"], string> = { "In transit":"En transit", Delayed:"Retard", Loading:"Chargement", Delivered:"Livré" };

export default function DemoPage() {
  const [selectedId, setSelectedId] = useState(deliveries[0].id);
  const selected = deliveries.find((delivery) => delivery.id === selectedId) ?? deliveries[0];
  const moving = deliveries.filter((delivery) => delivery.status === "In transit" || delivery.status === "Delayed").length;
  const delayed = deliveries.filter((delivery) => delivery.status === "Delayed").length;
  const averageProgress = Math.round(deliveries.reduce((sum, delivery) => sum + delivery.progress, 0) / deliveries.length);
  const mapDeliveries = useMemo(() => deliveries.map((delivery) => ({ ...delivery })), []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span className={styles.mark}>↗</span><span>TrackFleet</span></Link>
        <nav className={styles.nav} aria-label="Demo sections">
          <a href="#overview">Vue d’ensemble</a><a href="#deliveries">Livraisons</a><a href="#trips">Trajets</a><a href="#sites">Agences</a>
        </nav>
        <div className={styles.headerRight}><span className={styles.demoBadge}>MODE DÉMO · LECTURE SEULE</span><Link href="/" className={styles.loginLink}>Connexion entreprise</Link></div>
      </header>

      <section className={styles.hero} id="overview">
        <div><p className={styles.eyebrow}>CENTRE D’EXPLOITATION</p><h1>Dashboard TrackFleet</h1><p>Données fictives. Cette démo montre les principales vues de l’application sans exposer les données SENDATRACK réelles.</p></div>
        <div className={styles.providerCard}><span className={styles.providerDot}/><div><strong>SENDATRACK</strong><small>Connexion production disponible</small></div><b>Démo isolée</b></div>
      </section>

      <section className={styles.kpis}>
        <article><span>Livraisons actives</span><strong>{deliveries.length}</strong><small>{moving} véhicules en route</small></article>
        <article><span>Progression moyenne</span><strong>{averageProgress}%</strong><small>Sur les tournées affichées</small></article>
        <article><span>Retards à surveiller</span><strong>{delayed}</strong><small>Détection ETA ≥ 60 min</small></article>
        <article><span>Données live</span><strong>Stables</strong><small>Dernières données connues conservées</small></article>
      </section>

      <section className={styles.workspace}>
        <div className={styles.mapCard}>
          <div className={styles.sectionTitle}><div><p>FLOTTE</p><h2>Position des véhicules</h2></div><span>Carte interactive</span></div>
          <div className={styles.mapWrap}><InteractiveFleetMap deliveries={mapDeliveries} selectedId={selectedId} label="Carte de démonstration TrackFleet" onSelect={setSelectedId}/></div>
        </div>
        <aside className={styles.detailCard}>
          <div className={styles.detailTop}><span className={`${styles.status} ${selected.status === "Delayed" ? styles.delayed : selected.status === "Loading" ? styles.loading : styles.transit}`}>{statusLabel[selected.status]}</span><span>{selected.id}</span></div>
          <h2>{selected.customer}</h2><p className={styles.route}>{selected.truck}</p>
          <div className={styles.progressTrack}><i style={{width:`${selected.progress}%`}}/></div><div className={styles.progressMeta}><span>{selected.progress}% du trajet</span><b>ETA {selected.eta}</b></div>
          <dl><div><dt>Destination</dt><dd>{selected.destination}</dd></div><div><dt>Conducteur</dt><dd>{selected.driver}</dd></div><div><dt>Vitesse</dt><dd>{selected.speed} km/h</dd></div><div><dt>Confiance ETA</dt><dd>{selected.etaConfidence === "medium" ? "Moyenne" : "Faible"}</dd></div><div className={styles.fullRow}><dt>Calcul ETA</dt><dd>{selected.etaSource}</dd></div></dl>
          <div className={styles.readOnlyNote}>Clique sur une livraison ou un véhicule pour changer la sélection. Les actions d’écriture sont désactivées en démo.</div>
        </aside>
      </section>

      <section className={styles.tableCard} id="deliveries">
        <div className={styles.sectionTitle}><div><p>LIVRAISONS</p><h2>Dispatch du jour</h2></div><span>{deliveries.length} dossiers</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Référence</th><th>Client</th><th>Véhicule</th><th>Destination</th><th>Statut</th><th>ETA</th><th>Progression</th></tr></thead><tbody>{deliveries.map((delivery)=><tr key={delivery.id} onClick={()=>setSelectedId(delivery.id)} className={delivery.id===selectedId?styles.selectedRow:""}><td><strong>{delivery.id}</strong></td><td>{delivery.customer}</td><td>{delivery.truck.split(" · ")[0]}</td><td>{delivery.destination}</td><td><span className={`${styles.status} ${delivery.status === "Delayed" ? styles.delayed : delivery.status === "Loading" ? styles.loading : styles.transit}`}>{statusLabel[delivery.status]}</span></td><td>{delivery.eta}</td><td>{delivery.progress}%</td></tr>)}</tbody></table></div>
      </section>

      <section className={styles.operationsGrid} id="trips">
        <article className={styles.opsCard}><div className={styles.sectionTitle}><div><p>TRAJETS</p><h2>Tournées planifiées</h2></div><span>3 actives</span></div><div className={styles.opsBody}>
          <div className={styles.trip}><b>TR-17</b><span>Bruxelles → Tanger → Casablanca</span><em>2 colis · actif</em></div>
          <div className={styles.trip}><b>TR-22</b><span>Bruxelles → Rabat</span><em>1 colis · actif</em></div>
          <div className={styles.trip}><b>TR-03</b><span>Casablanca → Bruxelles</span><em>chargement</em></div>
        </div></article>
        <article className={styles.opsCard}><div className={styles.sectionTitle}><div><p>AUTOMATISATION</p><h2>ETA & détection</h2></div><span>Actif</span></div><div className={styles.opsBody}>
          <div className={styles.automation}><span>ETA apprises sur l’historique</span><b>En apprentissage</b></div>
          <div className={styles.automation}><span>Détection de retard</span><b>1 alerte</b></div>
          <div className={styles.automation}><span>Synchronisation GPS</span><b>Connectée en production</b></div>
        </div></article>
      </section>

      <section className={styles.sitesCard} id="sites">
        <div className={styles.sectionTitle}><div><p>AGENCES & DESTINATIONS</p><h2>Sites connus</h2></div><span>Géofences prêtes</span></div>
        <div className={styles.siteGrid}><div><b>Bruxelles</b><span>Agence départ · BE</span><small>50.8503, 4.3517</small></div><div><b>Tanger</b><span>Destination · MA</span><small>35.7595, -5.8340</small></div><div><b>Rabat</b><span>Destination · MA</span><small>34.0209, -6.8416</small></div><div><b>Casablanca</b><span>Hub & destination · MA</span><small>33.5731, -7.5898</small></div></div>
      </section>

      <footer className={styles.footer}>TrackFleet · Démonstration publique en lecture seule · Aucune donnée SENDATRACK réelle</footer>
    </main>
  );
}
