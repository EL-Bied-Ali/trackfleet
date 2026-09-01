"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./pricing.module.css";
import type { Locale } from "../i18n";

const copy = {
  fr: {
    eyebrow: "TARIFS",
    title: "Un tarif simple pour suivre votre flotte",
    subtitle: "Deux formules, sans engagement. Chaque nouveau compte commence par 14 jours d’essai gratuit avec toutes les fonctionnalités Pro.",
    perMonth: "/mois", perYear: "/an",
    standardName: "Standard",
    standardDesc: "Suivi GPS en temps réel et notifications de livraison.",
    standardFeatures: [
      "Suivi GPS en direct de chaque camion (SENDATRACK)",
      "Lien de suivi privé à partager avec vos clients",
      "Notifications de livraison automatiques par e-mail",
      "Tableau de bord opérations, historique et revenus",
      "Gestion multi-agences et multi-chauffeurs",
    ],
    proName: "Pro",
    proBadge: "Le plus populaire",
    proDesc: "Tout Standard, avec les notifications WhatsApp automatiques.",
    proFeatures: [
      "Tout ce qui est inclus dans Standard",
      "Notifications WhatsApp automatiques à vos clients",
      "Réponses automatiques aux questions de suivi",
    ],
    cta: "Se connecter et démarrer l’essai",
    requirement: "TrackFleet se connecte à un compte SENDATRACK existant — connectez-vous avec vos identifiants SENDATRACK habituels pour créer votre espace en quelques secondes.",
    footer: "Confidentialité",
    footerAnd: "et",
    footerDeletion: "suppression des données",
    back: "← Retour à la connexion",
  },
  en: {
    eyebrow: "PRICING",
    title: "Simple pricing to track your fleet",
    subtitle: "Two plans, no commitment. Every new account starts with a 14-day free trial with full Pro features.",
    perMonth: "/mo", perYear: "/yr",
    standardName: "Standard",
    standardDesc: "Real-time GPS tracking and delivery notifications.",
    standardFeatures: [
      "Live GPS tracking for every truck (SENDATRACK)",
      "Private tracking link to share with your customers",
      "Automatic delivery notifications by email",
      "Operations dashboard, history and revenue reports",
      "Multi-agency and multi-driver management",
    ],
    proName: "Pro",
    proBadge: "Most popular",
    proDesc: "Everything in Standard, plus automatic WhatsApp notifications.",
    proFeatures: [
      "Everything included in Standard",
      "Automatic WhatsApp notifications to your customers",
      "Automatic replies to tracking questions",
    ],
    cta: "Log in and start your trial",
    requirement: "TrackFleet connects to an existing SENDATRACK account — log in with your usual SENDATRACK credentials to create your workspace in seconds.",
    footer: "Privacy",
    footerAnd: "and",
    footerDeletion: "data deletion",
    back: "← Back to login",
  },
  nl: {
    eyebrow: "TARIEVEN",
    title: "Eenvoudige tarieven om uw wagenpark te volgen",
    subtitle: "Twee formules, zonder verbintenis. Elk nieuw account start met 14 dagen gratis proefperiode met alle Pro-functies.",
    perMonth: "/mnd", perYear: "/jaar",
    standardName: "Standard",
    standardDesc: "Live GPS-tracking en leveringsmeldingen.",
    standardFeatures: [
      "Live GPS-tracking van elke vrachtwagen (SENDATRACK)",
      "Privé trackinglink om te delen met uw klanten",
      "Automatische leveringsmeldingen per e-mail",
      "Dashboard voor operaties, geschiedenis en omzet",
      "Beheer van meerdere agentschappen en chauffeurs",
    ],
    proName: "Pro",
    proBadge: "Meest gekozen",
    proDesc: "Alles van Standard, met automatische WhatsApp-meldingen.",
    proFeatures: [
      "Alles wat inbegrepen is in Standard",
      "Automatische WhatsApp-meldingen naar uw klanten",
      "Automatische antwoorden op trackingvragen",
    ],
    cta: "Aanmelden en proefperiode starten",
    requirement: "TrackFleet koppelt aan een bestaand SENDATRACK-account — meld u aan met uw gebruikelijke SENDATRACK-gegevens om uw omgeving in enkele seconden aan te maken.",
    footer: "Privacybeleid",
    footerAnd: "en",
    footerDeletion: "gegevensverwijdering",
    back: "← Terug naar aanmelden",
  },
} as const;

const prices = {
  standard: { monthly: "€45", yearly: "€400" },
  pro: { monthly: "€90", yearly: "€800" },
} as const;

function localeFromUrl(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

export default function PricingPage() {
  const [locale, setLocale] = useState<Locale>(() => localeFromUrl());
  const t = copy[locale];

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></Link>
      <div className={styles.langSwitch} role="group" aria-label="Language">
        {(["fr", "en", "nl"] as const).map((option) => <button key={option} type="button" aria-current={locale === option} onClick={() => setLocale(option)}>{option.toUpperCase()}</button>)}
      </div>
    </header>

    <section className={styles.hero}>
      <p className="eyebrow">{t.eyebrow}</p>
      <h1>{t.title}</h1>
      <p>{t.subtitle}</p>
    </section>

    <section className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.cardHead}><h2>{t.standardName}</h2></div>
        <p className={styles.cardDesc}>{t.standardDesc}</p>
        <div className={styles.price}><strong>{prices.standard.monthly}</strong><span>{t.perMonth}</span></div>
        <p className={styles.yearly}>{prices.standard.yearly}{t.perYear}</p>
        <ul className={styles.features}>{t.standardFeatures.map((feature) => <li key={feature}><i>✓</i>{feature}</li>)}</ul>
        <Link href="/" className={styles.cta}>{t.cta}</Link>
      </div>

      <div className={`${styles.card} ${styles.pro}`}>
        <div className={styles.cardHead}><h2>{t.proName}</h2><span className={styles.badge}>{t.proBadge}</span></div>
        <p className={styles.cardDesc}>{t.proDesc}</p>
        <div className={styles.price}><strong>{prices.pro.monthly}</strong><span>{t.perMonth}</span></div>
        <p className={styles.yearly}>{prices.pro.yearly}{t.perYear}</p>
        <ul className={styles.features}>{t.proFeatures.map((feature) => <li key={feature}><i>✓</i>{feature}</li>)}</ul>
        <Link href="/" className={styles.cta}>{t.cta}</Link>
      </div>
    </section>

    <p className={styles.note}>{t.requirement}</p>

    <footer className={styles.footer}>
      <Link href="/">{t.back}</Link> · <Link href="/privacy">{t.footer}</Link> {t.footerAnd} <Link href="/data-deletion">{t.footerDeletion}</Link>
    </footer>
  </main>;
}
