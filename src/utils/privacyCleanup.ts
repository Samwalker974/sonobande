/**
 * Proactively removes any legacy client-side storage created by earlier versions
 * so Sonobande remains strictly ephemeral (zero persistence).
 */
export function purgeLegacyLocalData(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('sonobande-seeded-v1');
    }
  } catch {
    // Ignore storage restriction
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('sonobande-library-v1');
    }
  } catch {
    // Ignore IndexedDB restriction
  }
}
