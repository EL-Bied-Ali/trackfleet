const enabledValues = new Set(["1", "true", "yes", "on", "enabled"]);

export function resolveD1ReadFailoverConfigured(rawValue: string | undefined, platform: string) {
  const raw = rawValue?.trim().toLowerCase() ?? "";
  if (!raw) return platform === "cloudflare";
  return enabledValues.has(raw);
}

// A primary read failing because the invocation already exceeded
// Cloudflare's per-invocation subrequest limit is unrecoverable within this
// same invocation: the readiness check, the lease-activation write and the
// standby read below are each their own subrequest, and every one of them
// would fail for the identical reason. Reproduced live via wrangler tail --
// this cascade was itself occasionally the thing tipping an otherwise-fine
// invocation over the edge. Fail fast instead of spending budget you don't
// have chasing a fallback that can't succeed.
function isSubrequestLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Too many subrequests");
}

export async function executeReadFailover<T>(input: {
  primaryRead: () => Promise<T>;
  approveFailover: () => Promise<boolean>;
  standbyRead: () => Promise<T>;
  onFailover?: (primaryError: unknown) => void;
  onStandbyFailure?: (primaryError: unknown, standbyError: unknown) => void;
}): Promise<T> {
  try {
    return await input.primaryRead();
  } catch (primaryError) {
    if (isSubrequestLimitError(primaryError)) throw primaryError;
    if (!(await input.approveFailover())) throw primaryError;
    input.onFailover?.(primaryError);

    try {
      return await input.standbyRead();
    } catch (standbyError) {
      input.onStandbyFailure?.(primaryError, standbyError);
      throw primaryError;
    }
  }
}

export function shouldBlockMutationDuringReadFailover(method: string, leaseActive: boolean) {
  if (!leaseActive) return false;
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}
