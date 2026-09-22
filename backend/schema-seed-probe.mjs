#!/usr/bin/env node

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { handleRpcRequest, parseProtocolLine } from "../src/probe-protocol.mjs";

export async function serve(input = process.stdin, output = process.stdout) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseProtocolLine(line);
    const response = parsed.ok ? handleRpcRequest(parsed.value) : parsed.response;
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  serve().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
