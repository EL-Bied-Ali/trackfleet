import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Data Deletion — TrackFleet",
  description: "Instructions for requesting deletion of data processed through TrackFleet.",
};

export default function DataDeletionPage() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link className={styles.brand} href="/">TrackFleet</Link>
        <h1 className={styles.title}>Data deletion instructions</h1>
        <p className={styles.updated}>Last updated: 18 August 2026</p>

        <section className={styles.section}>
          <h2>If you received a TrackFleet tracking link</h2>
          <p>
            The transport company that created your delivery is the organization that can identify the corresponding
            delivery record. Contact that company and provide the delivery or tracking reference shown to you. Ask it
            to delete the personal data associated with that delivery or to explain any retention requirement that
            prevents immediate deletion.
          </p>
        </section>

        <section className={styles.section}>
          <h2>If your phone number is used for WhatsApp updates</h2>
          <p>
            Tell the transport company that you withdraw consent for future WhatsApp delivery notifications and request
            deletion or correction of the phone number associated with the delivery where applicable. Do not publish
            access tokens, passwords or other account credentials in a deletion request.
          </p>
        </section>

        <section className={styles.section}>
          <h2>If you operate a TrackFleet business account</h2>
          <p>
            Contact the administrator responsible for your TrackFleet deployment and identify the company account and
            records that should be removed. The administrator may need to verify the request before deleting business,
            delivery, integration or fleet-history data.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What happens next</h2>
          <p>
            A valid deletion request should be applied to records that are no longer required for the service. Some
            information may need to be retained when the transport company has an accounting, security, contractual or
            legal obligation to keep it. Where that applies, the company handling the request should explain the reason.
          </p>
        </section>

        <section className={styles.section}>
          <p className={styles.note}>
            TrackFleet tracking links are private references. Share a tracking reference only with the organization
            handling your request, not in a public post or forum.
          </p>
        </section>

        <nav className={styles.links} aria-label="Legal links">
          <Link href="/">TrackFleet</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>
      </article>
    </main>
  );
}
