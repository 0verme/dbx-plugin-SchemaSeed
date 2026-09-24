#!/usr/bin/env node

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { parseProtocolLine, handleRpcRequest as handleProbeRpcRequest } from "../src/probe-protocol.mjs";
import { GENERATION_PREVIEW_METHOD, handleGenerationRuntimeRequest } from "../src/generation/generation-runtime-protocol.mjs";

/**
 * Multiplex the isolated Phase 0 Probe RPC and the production Workbench Core
 * RPC. Each method keeps its own contract and implementation boundary.
 */
export function handleRuntimeRpcRequest(request) {
  if (request && typeof request === "object" && request.method === GENERATION_PREVIEW_METHOD) {
    return handleGenerationRuntimeRequest(request);
  }
  return handleProbeRpcRequest(request);
}

/** @param {NodeJS.ReadableStream} input @param {NodeJS.WritableStream} output */
export async function serve(input = process.stdin, output = process.stdout) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseProtocolLine(line);
    const response = parsed.ok ? handleRuntimeRpcRequest(parsed.value) : parsed.response;
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  serve().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
