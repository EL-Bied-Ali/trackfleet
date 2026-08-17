export type LoginErrorKind = "invalid_credentials" | "service_unavailable" | "login_failed";

export function classifyLoginError(status: number, code?: string | null): LoginErrorKind {
  if (status === 401 || code === "authentication_failed") return "invalid_credentials";
  if (status === 503 || code === "sendatrack_unavailable") return "service_unavailable";
  return "login_failed";
}
