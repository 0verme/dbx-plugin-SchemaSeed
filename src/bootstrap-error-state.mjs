const CONNECTION_URI_PATTERN = /\b(?:jdbc:[a-z][a-z0-9+.-]*|(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|oracle|sqlserver)):\/\/[^\s"'<>]+/gi;
const SECRET_PARAMETER_PATTERN = /\b(password|passwd|pwd|token|secret|credential|credentials|authorization|bearer|api[\s_-]?key|access[_-]?key)\s*([=:]\s*|\s+)(?:bearer\s+[^\s,;&]+|"[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/** Return an error summary suitable for ordinary UI, without stacks or connection secrets. */
export function safeBootstrapErrorMessage(error, redactedText = "[redacted]") {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return rawMessage
    .replace(CONNECTION_URI_PATTERN, redactedText)
    .replace(SECRET_PARAMETER_PATTERN, (_match, key, separator) => `${key}${separator}${redactedText}`)
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, `://${redactedText}@`)
    .slice(0, 500);
}

/** Restore a visible, safe fatal state after any bootstrap or Workbench failure. */
export function showFatalBootError({
  boot,
  bootMessage,
  fatal,
  title,
  description,
  detail,
  retryButton,
  generationRoot,
  phase0Root,
  titleText,
  descriptionText,
  errorLabel,
  retryText,
  redactedText,
  stage,
  error,
}) {
  generationRoot.hidden = true;
  phase0Root.hidden = true;
  boot.hidden = false;
  boot.setAttribute("role", "alert");
  bootMessage.hidden = true;
  fatal.hidden = false;
  title.hidden = false;
  description.hidden = false;
  detail.hidden = false;
  retryButton.hidden = false;
  title.textContent = titleText;
  description.textContent = descriptionText;
  retryButton.textContent = retryText;

  const message = safeBootstrapErrorMessage(error, redactedText);
  detail.textContent = `${errorLabel}${message}`;
  const errorName = error instanceof Error && error.name ? error.name : "Error";
  console.error("[SchemaSeed] bootstrap failed", { stage, name: errorName, message });
}
