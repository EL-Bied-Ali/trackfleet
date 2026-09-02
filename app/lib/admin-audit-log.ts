import { getSql } from "./pg-client.ts";

// Every admin action that touches a company -- impersonating it or
// overriding its subscription status -- gets logged here, since both are
// genuinely sensitive (impersonation exposes real customer contacts/pricing;
// a status override bypasses Paddle entirely). This is fire-and-forget from
// the caller's perspective (see admin routes): logging failure must never
// block the underlying action, only get reported.
export async function logAdminAction(input: {
  adminEmail: string;
  action: string;
  targetCompanyId?: string | null;
  detail?: string | null;
}) {
  const sql = getSql();
  await sql`
    INSERT INTO admin_audit_log (admin_email, action, target_company_id, detail, created_at)
    VALUES (${input.adminEmail}, ${input.action}, ${input.targetCompanyId ?? null}, ${input.detail ?? null}, ${new Date().toISOString()})
  `;
}
