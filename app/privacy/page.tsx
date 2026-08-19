import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — TrackFleet",
  description: "How TrackFleet handles delivery, tracking and notification data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link className={styles.brand} href="/">TrackFleet</Link>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: 19 August 2026</p>

        <section className={styles.section}>
          <h2>1. What TrackFleet does</h2>
          <p>
            TrackFleet helps transport teams manage deliveries, connect delivery records to fleet-position data,
            estimate arrival times, provide private tracking links and send operational delivery notifications.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Data processed</h2>
          <p>Depending on how a transport company uses TrackFleet, the service may process:</p>
          <ul>
            <li>delivery identifiers, customer names and customer contact numbers;</li>
            <li>origin, destination, planned arrival and delivery-status information;</li>
            <li>vehicle position, speed, route and timestamp information supplied by a fleet provider;</li>
            <li>delivery events, ETA observations and operational history;</li>
            <li>WhatsApp notification consent and the time that consent was recorded;</li>
            <li>business-account and integration configuration needed to operate the service.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>3. Why the data is used</h2>
          <p>
            Data is used to operate the delivery service, display private customer tracking, calculate and improve
            ETA information, synchronize fleet operations, send requested service notifications, troubleshoot the
            service and protect it from misuse.
          </p>
        </section>

        <section className={styles.section}>
          <h2>4. WhatsApp notifications</h2>
          <p>
            TrackFleet only prepares automatic customer WhatsApp notifications for a delivery when the transport
            company has recorded an explicit opt-in for that delivery and a valid customer phone number is present.
            Detailed tracking remains available through the private tracking link.
          </p>
        </section>

        <section className={styles.section}>
          <h2>5. Service providers</h2>
          <p>
            TrackFleet may transmit the minimum data needed to infrastructure, database, fleet-tracking and messaging
            providers used by the transport company. For WhatsApp notifications, message data is processed by Meta&apos;s
            WhatsApp Business Platform. Fleet-position data may be obtained from the configured fleet provider.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. Public tracking and credentials</h2>
          <p>
            Customer tracking is accessed through a private tracking token. Provider credentials are never included in
            public tracking responses. When company authentication is used, the authenticated session is stored in an
            encrypted, HttpOnly and Secure session cookie so browser scripts cannot read the session contents directly.
          </p>
        </section>

        <section className={styles.section}>
          <h2>7. Retention</h2>
          <p>
            Tracking links are time-limited. Operational records may be retained by the transport company for service,
            support, security, accounting or legal purposes. Retention requirements can therefore vary by deployment.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Your choices and requests</h2>
          <p>
            If you are a delivery recipient, contact the transport company that provided your tracking link to ask
            about your data, correct it, object to messaging or request deletion where applicable. The transport company
            is the appropriate first contact for delivery-specific records because it created and manages that delivery.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Security</h2>
          <p>
            TrackFleet is designed to separate public tracking data from authenticated company data, protect provider
            credentials in authenticated session state and scope operational data to the company that owns it. No
            internet service can guarantee absolute security.
          </p>
        </section>

        <section className={styles.section}>
          <h2>10. Changes</h2>
          <p>
            This policy may be updated as TrackFleet changes. The date at the top of this page identifies the current
            version.
          </p>
        </section>

        <nav className={styles.links} aria-label="Legal links">
          <Link href="/">TrackFleet</Link>
          <Link href="/data-deletion">Data deletion instructions</Link>
        </nav>
      </article>
    </main>
  );
}
