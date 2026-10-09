/**
 * The Host's post-ready context is authoritative, including an explicit null.
 * The one-shot init payload is only a fallback when the bridge has no value.
 * @param {{ context?: unknown }} host
 * @param {unknown} fallback
 */
export function selectInitialContext(host, fallback) {
  return host.context === undefined ? fallback : host.context;
}
