const DEFAULT_CONTEXT_TTL_MS = 10 * 60 * 1000;

/**
 * Plugin-owned, in-memory handoff for the two public DBX surfaces:
 * context-menu backend RPC -> user-opened Workbench backend RPC.
 * Only normalized table identity is retained, and it is consumed once.
 *
 * @param {{ ttlMs?: number, now?: () => number }} options
 */
export function createPendingTableContextStore({ ttlMs = DEFAULT_CONTEXT_TTL_MS, now = Date.now } = {}) {
  let pending;

  return Object.freeze({
    /** @param {Record<string, string>} context */
    remember(context) {
      const snapshot = { connectionId: context.connectionId, table: context.table };
      if (context.database !== undefined) snapshot.database = context.database;
      if (context.schema !== undefined) snapshot.schema = context.schema;
      pending = { context: Object.freeze(snapshot), expiresAt: now() + ttlMs };
    },
    take() {
      if (!pending) return null;
      const current = pending;
      pending = undefined;
      return current.expiresAt > now() ? current.context : null;
    },
    clear() {
      pending = undefined;
    },
  });
}

export const pendingTableContextStore = createPendingTableContextStore();
