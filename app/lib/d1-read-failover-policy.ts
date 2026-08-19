const enabledValues = new Set(["1", "true", "yes", "on", "enabled"]);

export function resolveD1ReadFailoverConfigured(rawValue: string | undefined, platform: string) {
  const raw = rawValue?.trim().toLowerCase() ?? "";
  if (!raw) return platform === "cloudflare";
  return enabledValues.has(raw);
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
