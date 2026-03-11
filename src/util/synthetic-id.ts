/**
 * Generate a unique numeric message_id for synthetic events (proactive, poke, offline file).
 * Avoids dedup collisions when multiple synthetic events occur within dedupTtlMs (e.g. 30s).
 * OneBot message_id is typically a number; this stays within Number.MAX_SAFE_INTEGER.
 */
export function getSyntheticMessageId(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}
