/**
 * localStorage that never throws. Browsers refuse it in some private modes, with site data blocked, or when the quota
 * is full; none of that should take the app down, so a failed read is "nothing saved" and a failed write is ignored.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the app keeps working with what it has in memory.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
