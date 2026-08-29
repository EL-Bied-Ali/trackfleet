"use client";

import { useEffect, useState } from "react";

type Company = {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  createdAt: string;
  subscriptionStatus: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
};

const statusOptions = ["grandfathered", "trialing", "active", "past_due", "canceled"];

function statusLabel(status: string | null) {
  return status ?? "none (no access)";
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [email, setEmail] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  // Starts true: the moment authState becomes "authenticated" a fetch kicks
  // off (see below), so there's no intermediate "not loading yet" state
  // worth representing.
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [pendingCompanyId, setPendingCompanyId] = useState<string | null>(null);
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  // Computed once from the URL at mount via a lazy initializer, rather than
  // an effect that calls setState synchronously -- the URL is read exactly
  // once, so there's nothing to "synchronize" on an ongoing basis here.
  const [deniedReason] = useState(() => {
    if (typeof window === "undefined") return "";
    const error = new URLSearchParams(window.location.search).get("admin_error");
    if (error === "not_allowed") return "That Google account isn't on the admin allowlist.";
    if (error) return "Admin sign-in failed. Please try again.";
    return "";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("admin_error")) return;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("admin_error");
    window.history.replaceState({}, "", cleanUrl);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/session", { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setAuthState("anonymous"); return; }
      const data = await response.json() as { email: string };
      setEmail(data.email);
      setAuthState("authenticated");
    }).catch(() => { if (active) setAuthState("anonymous"); });
    return () => { active = false; };
  }, []);

  async function loadCompanies() {
    setCompaniesLoading(true);
    try {
      const response = await fetch("/api/admin/companies", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { companies: Company[] };
      setCompanies(data.companies);
    } finally {
      setCompaniesLoading(false);
    }
  }

  useEffect(() => {
    if (authState !== "authenticated") return;
    let active = true;
    void fetch("/api/admin/companies", { cache: "no-store" }).then(async (response) => {
      if (!active || !response.ok) return;
      const data = await response.json() as { companies: Company[] };
      if (active) setCompanies(data.companies);
    }).finally(() => { if (active) setCompaniesLoading(false); });
    return () => { active = false; };
  }, [authState]);

  async function saveStatus(companyId: string) {
    const status = statusDrafts[companyId];
    if (!status) return;
    setPendingCompanyId(companyId);
    try {
      const response = await fetch("/api/admin/companies/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, status }),
      });
      if (!response.ok) { setToast("Failed to update subscription."); return; }
      setToast("Subscription updated.");
      await loadCompanies();
    } finally {
      setPendingCompanyId(null);
    }
  }

  async function viewAs(companyId: string) {
    setPendingCompanyId(companyId);
    try {
      const response = await fetch("/api/admin/companies/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) { setToast("Failed to view as this company."); return; }
      window.location.href = "/";
    } finally {
      setPendingCompanyId(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthState("anonymous");
    setCompanies([]);
  }

  if (authState === "loading") return <main style={{ padding: 40, fontFamily: "sans-serif" }}>Loading…</main>;

  if (authState === "anonymous") {
    return (
      <main style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 420 }}>
        <h1>TrackFleet Admin</h1>
        {deniedReason && <p style={{ color: "#9a3e31" }}>{deniedReason}</p>}
        <a
          href="/api/auth/admin/google/start"
          style={{ display: "inline-block", marginTop: 16, padding: "10px 18px", background: "#9c2b2b", color: "white", borderRadius: 8, textDecoration: "none" }}
        >
          Sign in with Google
        </a>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>TrackFleet Admin</h1>
        <div>
          <span style={{ marginRight: 16, color: "#666" }}>{email}</span>
          <button onClick={() => void logout()}>Log out</button>
        </div>
      </div>
      {toast && <p>{toast}</p>}
      {companiesLoading ? <p>Loading companies…</p> : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>Account</th>
              <th style={{ padding: 8 }}>Created</th>
              <th style={{ padding: 8 }}>Plan</th>
              <th style={{ padding: 8 }}>Subscription</th>
              <th style={{ padding: 8 }}>Set status</th>
              <th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.companyId} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>{company.accountLabel}</td>
                <td style={{ padding: 8 }}>{new Date(company.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: 8 }}>{company.plan ?? "—"}</td>
                <td style={{ padding: 8 }}>{statusLabel(company.subscriptionStatus)}</td>
                <td style={{ padding: 8 }}>
                  <select
                    value={statusDrafts[company.companyId] ?? company.subscriptionStatus ?? "canceled"}
                    onChange={(event) => setStatusDrafts((current) => ({ ...current, [company.companyId]: event.target.value }))}
                  >
                    {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <button disabled={pendingCompanyId === company.companyId} onClick={() => void saveStatus(company.companyId)} style={{ marginLeft: 8 }}>
                    Save
                  </button>
                </td>
                <td style={{ padding: 8 }}>
                  <button disabled={pendingCompanyId === company.companyId} onClick={() => void viewAs(company.companyId)}>
                    View as
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
