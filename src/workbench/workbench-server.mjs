import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WorkbenchController } from "./workbench-controller.mjs";

const WEB_ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/render.mjs", ["render.mjs", "text/javascript; charset=utf-8"]],
]);
const MAX_ACTION_BYTES = 16_384;

/** Create a loopback-only development server; this is not a DBX plugin entrypoint. */
export function createWorkbenchServer(options = {}) {
  const controller = options.controller ?? new WorkbenchController(options.controllerOptions);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, await controller.initialize());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const action = await readJsonBody(request);
        sendJson(response, 200, await controller.dispatch(action));
        return;
      }
      if (request.method === "GET" && ASSETS.has(url.pathname)) {
        const [filename, contentType] = ASSETS.get(url.pathname);
        const contents = await readFile(path.join(WEB_ROOT, filename));
        response.writeHead(200, {
          "content-type": contentType,
          "content-length": contents.length,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(contents);
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
      sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** @param {import("node:http").IncomingMessage} request */
async function readJsonBody(request) {
  let byteLength = 0;
  const chunks = [];
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > MAX_ACTION_BYTES) throw new RangeError("Workbench action payload is too large");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Workbench action must be a JSON object");
  }
  return parsed;
}

/** @param {import("node:http").ServerResponse} response @param {number} status @param {unknown} value */
function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}
