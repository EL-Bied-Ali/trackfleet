import { neon } from "@neondatabase/serverless";

export type GoogleLinkedCompany = {
  companyId: string;
  credentialsCiphertext: string;
};

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Google account links");
  return neon(databaseUrl);
}

// Joined with `companies` in one query -- a Google login always immediately
// needs the linked company's stored SENDATRACK credentials to actually
// establish a session, so there's no case where the caller wants the link
// row without them.
export async function getGoogleLinkedCompany(googleSub: string): Promise<GoogleLinkedCompany | null> {
  const sql = sqlClient();
  const rows = await sql`
    SELECT c.id AS company_id, c.credentials_ciphertext
    FROM google_links g
    JOIN companies c ON c.id = g.company_id
    WHERE g.google_sub = ${googleSub}
    LIMIT 1
  ` as Array<{ company_id: string; credentials_ciphertext: string }>;
  const row = rows[0];
  if (!row) return null;
  return { companyId: row.company_id, credentialsCiphertext: row.credentials_ciphertext };
}

export async function createGoogleLink(input: { googleSub: string; email: string; companyId: string }) {
  const sql = sqlClient();
  await sql`
    INSERT INTO google_links (google_sub, email, company_id, created_at)
    VALUES (${input.googleSub}, ${input.email}, ${input.companyId}, ${new Date().toISOString()})
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      company_id = EXCLUDED.company_id
  `;
}
