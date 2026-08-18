export type LoginErrorKind = "invalid_credentials" | "service_unavailable" | "login_failed";

type PublicLoginFailure = {
  status: 400 | 401 | 503;
  code: "invalid_request" | "missing_credentials" | "authentication_failed" | "sendatrack_unavailable" | "login_failed";
};

export function classifyLoginError(status: number, code?: string | null): LoginErrorKind {
  if (status === 401 || code === "authentication_failed") return "invalid_credentials";
  if (status === 503 || code === "sendatrack_unavailable") return "service_unavailable";
  return "login_failed";
}

export function publicLoginFailure(error: unknown): PublicLoginFailure {
  if (error instanceof SyntaxError) return { status: 400, code: "invalid_request" };
  const code = error instanceof Error ? error.message : "login_failed";
  if (code === "missing_credentials") return { status: 400, code };
  if (code === "authentication_failed") return { status: 401, code };
  if (code === "sendatrack_unavailable") return { status: 503, code };
  return { status: 503, code: "login_failed" };
}
