#!/usr/bin/env node

import { createWorkbenchServer } from "../src/workbench/workbench-server.mjs";

const port = Number(process.env.PORT ?? 4173);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
  throw new RangeError("PORT must be an integer from 0 to 65535");
}

const server = createWorkbenchServer();
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`SchemaSeed standalone Workbench: http://127.0.0.1:${actualPort}\n`);
  process.stdout.write("Fixture-only development harness; not packaged in DBX. Press Ctrl+C to stop.\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
