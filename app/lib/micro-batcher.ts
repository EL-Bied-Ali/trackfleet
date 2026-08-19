type RecordLoader<T> = (keys: string[]) => Promise<Record<string, T>>;
type LimitedArrayLoader<T> = (keys: string[], maxLimit: number) => Promise<Record<string, T[]>>;

export function createRecordBatcher<T>(loader: RecordLoader<T>, fallback: () => T) {
  let pending: Array<{ key: string; resolve: (value: T) => void; reject: (error: unknown) => void }> = [];
  let scheduled = false;

  async function flush() {
    scheduled = false;
    const batch = pending;
    pending = [];
    const keys = [...new Set(batch.map((entry) => entry.key))];
    try {
      const loaded = await loader(keys);
      for (const entry of batch) entry.resolve(loaded[entry.key] ?? fallback());
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }

  return (key: string) => new Promise<T>((resolve, reject) => {
    pending.push({ key, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => void flush());
    }
  });
}

export function createLimitedArrayBatcher<T>(
  loader: LimitedArrayLoader<T>,
  normalizeLimit: (limit: number | undefined) => number,
) {
  let pending: Array<{ key: string; limit: number; resolve: (value: T[]) => void; reject: (error: unknown) => void }> = [];
  let scheduled = false;

  async function flush() {
    scheduled = false;
    const batch = pending;
    pending = [];
    const keys = [...new Set(batch.map((entry) => entry.key))];
    const maxLimit = Math.max(...batch.map((entry) => entry.limit));
    try {
      const loaded = await loader(keys, maxLimit);
      for (const entry of batch) entry.resolve((loaded[entry.key] ?? []).slice(0, entry.limit));
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }

  return (key: string, limit?: number) => new Promise<T[]>((resolve, reject) => {
    pending.push({ key, limit: normalizeLimit(limit), resolve, reject });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => void flush());
    }
  });
}
