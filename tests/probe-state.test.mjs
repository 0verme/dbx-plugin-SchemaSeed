import assert from "node:assert/strict";
import { test } from "node:test";

import { createPendingTableContextStore } from "../src/probe-state.mjs";

test("pending table context is latest-only, short-lived, identity-only, and consumed once", () => {
  let now = 10;
  const store = createPendingTableContextStore({ ttlMs: 100, now: () => now });
  store.remember({ connectionId: "c1", database: "db", schema: "public", table: "old", ignored: "not copied" });
  store.remember({ connectionId: "c2", table: "new" });

  assert.deepEqual(store.take(), { connectionId: "c2", table: "new" });
  assert.equal(store.take(), null);

  store.remember({ connectionId: "c1", table: "expired" });
  now = 111;
  assert.equal(store.take(), null);
});
