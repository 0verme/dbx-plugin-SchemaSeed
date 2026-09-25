/**
 * Canonical en-US message catalog. This catalog is the reference locale: every
 * key that exists in another locale must exist here, and the i18n lookup
 * always falls back to this object.
 *
 * Keys are flat and dotted so that a locale key can be checked statically and
 * so that missing translations are easy to spot in a diff. `{name}` segments
 * are interpolated placeholders.
 *
 * This file contains UI copy only. Database / table / column names, SQL, DB
 * types, diagnostic codes, rule identities and evidence ids are never
 * translated and never appear here.
 */
export const EN_US_MESSAGES = Object.freeze({
  // Application shell.
  "app.titleSuffix": "Generation Workbench",
  "app.subtitle": "DBX Table Context · schema-aware synthetic data",
  "app.boot.connecting": "Connecting to the DBX Plugin Host…",
  "app.boot.bridgeUnavailable": "The DBX Plugin Host bridge is unavailable.",
  "app.boot.failed": "SchemaSeed failed to initialize: {message}",

  // Table context.
  "context.title": "Current table",
  "context.caption": "Uses the DBX TableContext directly; database / schema are optional",
  "context.database": "Database",
  "context.schema": "Schema",
  "context.table": "Table",

  // Dataset controls.
  "controls.rows": "Rows",
  "controls.rowsRange": "1–100",
  "controls.seed": "Seed",
  "controls.dataLocale": "Data language",
  "controls.localeNote": "UI language changes interface text only. Data language (zh-CN / en) only shapes synthetic generated values. The two are independent.",
  "controls.uiLocale": "UI language",

  // Primary actions.
  "actions.generate": "Generate",
  "actions.regenerateSameSeed": "Regenerate Same Seed",
  "actions.newSeed": "New Seed",

  // Column / strategy table.
  "columns.title": "Columns and current generation strategy",
  "columns.caption": "Generator, semantic mapping and evidence come from the current GenerationPlan",
  "columns.header.column": "Column",
  "columns.header.schemaType": "Schema Type",
  "columns.header.strategy": "Generator / Semantic Mapping",
  "columns.header.mappingStatus": "Mapping status",
  "columns.header.rules": "Rule Editor / Diagnostics",
  "columns.strategyDetail": "{source} · detected {detected} ({confidence})",
  "columns.empty.loading": "Loading schema metadata…",
  "columns.empty.none": "No columns to display.",
  "columns.evidenceSummary": "{count} evidence item(s)",
  "columns.evidenceItem": "{source}: {observation} — {explanation}",
  "columns.ruleDiagnostic": "{title}",
  "columns.ruleSelectLabel": "{column} generation rule",
  "columns.none": "—",

  // Rule editor state line.
  "ruleEditor.state.loading": "Load a DBX table schema before editing generation rules.",
  "ruleEditor.state.validating": "Core is validating the updated rule; Preview and Export remain invalidated.",
  "ruleEditor.state.generating": "GenerationPlan and dataset are being rebuilt…",
  "ruleEditor.state.error": "Rule Editor is unavailable because the Host or runtime request failed.",
  "ruleEditor.state.dirty": "Rules are validated; preview is stale. Generate to create a dataset.",
  "ruleEditor.state.blocked": "A rule or schema diagnostic blocks generation; fix it before Generate or Export.",
  "ruleEditor.state.warning": "Rules are ready with Core warnings; Preview remains available.",
  "ruleEditor.state.ready": "Rules are scoped to this table session. Editing any rule invalidates Preview and Export.",

  // Generation rule names (keyword identifiers stay recognizable).
  "ruleKind.auto": "Auto",
  "ruleKind.constant": "Constant",
  "ruleKind.sequence": "Sequence",
  "ruleKind.random_integer": "Random Integer",
  "ruleKind.random_decimal": "Random Decimal",
  "ruleKind.random_string": "Random String",
  "ruleKind.enum": "Enum",
  "ruleKind.boolean_ratio": "Boolean Ratio",
  "ruleKind.date_range": "Date Range",
  "ruleKind.timestamp_range": "Timestamp Range",
  "ruleKind.uuid": "UUID",
  "ruleKind.null_ratio": "Null Ratio",
  "ruleKind.semantic": "Semantic",

  // Effective generator for schema-type fallbacks.
  "generatorKind.integer": "Integer",
  "generatorKind.decimal": "Decimal",
  "generatorKind.varchar": "Text",
  "generatorKind.string": "Text",
  "generatorKind.boolean": "Boolean",
  "generatorKind.date": "Date",
  "generatorKind.timestamp": "Timestamp",
  "generatorKind.uuid": "UUID",
  "generatorKind.unsupported": "Unsupported",
  "generatorKind.unknown": "Unknown",

  // Source of the effective generation rule reported by the Core.
  "ruleSource.auto": "auto",
  "ruleSource.schema_type_fallback": "schema type fallback",
  "ruleSource.explicit_user_rule": "explicit user rule",
  "ruleSource.explicit_user_semantic_override": "explicit semantic override",
  "ruleSource.confirmed_semantic_mapping": "confirmed semantic mapping",

  // Rule editor field labels, keyed by field key.
  "ruleField.value": "Value (JSON scalar)",
  "ruleField.start": "Start",
  "ruleField.step": "Step",
  "ruleField.min": "Min",
  "ruleField.max": "Max",
  "ruleField.length": "Length",
  "ruleField.values": "Values (JSON array)",
  "ruleField.trueRatio": "True ratio (0–1)",
  "ruleField.ratio": "Null ratio (0–1)",
  "ruleField.semanticType": "Semantic type",
  "ruleField.date_range.start": "Start (UTC)",
  "ruleField.date_range.end": "End (UTC)",
  "ruleField.timestamp_range.start": "Start (UTC)",
  "ruleField.timestamp_range.end": "End (UTC)",

  // Schema type state words (raw DB types are never translated).
  "schemaType.state.unknown": "Unknown type",
  "schemaType.state.absent": "Not provided",
  "schemaType.state.not_applicable": "Not applicable",

  // Mapping status: presentation only, the Core enum is unchanged.
  "mappingStatus.explicit": "Explicit · {kind}",
  "mappingStatus.confirmed": "Confirmed",
  "mappingStatus.override": "Override",
  "mappingStatus.confirmedIncompatible": "Confirmed mapping incompatible · fallback active",
  "mappingStatus.overrideIncompatible": "Override incompatible · fallback active",
  "mappingStatus.needsConfirmation": "Needs confirmation · fallback active",
  "mappingStatus.ambiguous": "Ambiguous · fallback",
  "mappingStatus.incompatible": "Incompatible · fallback",
  "mappingStatus.fallback": "Fallback",

  "confidence.high": "High",
  "confidence.medium": "Medium",
  "confidence.low": "Low",
  "confidence.unknown": "Unknown",

  "semantic.unknown": "Unknown",
  "semantic.name": "Name",
  "semantic.gender": "Gender",
  "semantic.birthday": "Birthday",
  "semantic.mobile": "Mobile",
  "semantic.email": "Email",
  "semantic.address": "Address",
  "detected.ambiguous": "Ambiguous · {candidates}",

  // Constraints.
  "constraints.title": "Constraints",
  "constraints.caption": "SchemaSeed generation obligations only; these are not database constraint metadata.",
  "constraints.add": "+ Add Constraint",
  "constraints.header.kind": "Type",
  "constraints.header.columns": "Columns (ordered for composite)",
  "constraints.header.plan": "Plan / Capacity",
  "constraints.header.actions": "",
  "constraints.empty.noTable": "Load a table to configure constraints.",
  "constraints.empty.none": "No SchemaSeed generation constraints configured.",
  "constraints.kind.unique": "Unique",
  "constraints.kind.composite_unique": "Composite Unique",
  "constraints.kind.required_unique": "Required + Unique",
  "constraints.delete": "Delete",
  "constraints.columnsAriaLabel": "{id} ordered columns as JSON array",
  "constraints.plan.pending": "Plan pending validation",
  "constraints.plan.ready": "{satisfiable} · capacity {capacity}{blocked}",
  "constraints.plan.blockedSuffix": " · blocked",
  "constraints.satisfiable.yes": "satisfiable",
  "constraints.satisfiable.no": "unsatisfiable",
  "constraints.satisfiable.unknown": "not proven",
  "constraints.capacity.unknown": "unknown / cannot prove",
  "constraints.state.loading": "Load a DBX table schema before editing constraints.",
  "constraints.state.validating": "Core is validating constraints; Preview and Export remain invalidated.",
  "constraints.state.dirty": "Constraints are valid; Preview is stale. Generate to create a dataset.",
  "constraints.state.blocked": "A manual constraint or rule conflict blocks Generate and Export; review Core diagnostics.",
  "constraints.state.error": "Constraint validation runtime failed.",
  "constraints.state.ready": "Constraints are explicit SchemaSeed generation obligations scoped to this table session.",
  "constraints.state.warning": "Constraints are ready with Core warnings; Preview remains available.",

  // Diagnostics.
  "diagnostics.title": "Diagnostics",
  "diagnostics.caption": "Host provider / Core diagnostics rendered in the current UI language",
  "diagnostics.empty.loading": "Loading…",
  "diagnostics.empty.blocked": "No diagnostic detail is available, but generation is still blocked.",
  "diagnostics.empty.error": "Host or runtime error.",
  "diagnostics.empty.warning": "Core returned warnings; check the column-level diagnostics.",
  "diagnostics.empty.none": "No Core diagnostics.",
  "diagnostics.headline": "{level}: {title}",
  "diagnostics.level.blocking": "Blocking",
  "diagnostics.level.warning": "Warning",
  "diagnostics.level.error": "Error",
  "diagnostics.level.unsupported": "Unsupported",
  "diagnostics.level.needs_confirmation": "Needs confirmation",
  "diagnostics.actionLabel": "Suggested action:",
  "diagnostics.technicalSummary": "View technical details",
  "diagnostics.technical.code": "Diagnostic code",
  "diagnostics.technical.severity": "Severity",
  "diagnostics.technical.blocking": "Blocking",
  "diagnostics.technical.table": "Table",
  "diagnostics.technical.column": "Column",
  "diagnostics.technical.rule": "Rule",
  "diagnostics.technical.reason": "Raw Core message",
  "diagnostics.technical.yes": "yes",
  "diagnostics.technical.no": "no",
  "diagnostics.fallback.title": "Unclassified diagnostic ({code})",
  "diagnostics.fallback.description": "Core returned a diagnostic code that is not localized yet. Raw message: {reason}",
  "diagnostics.genericColumn": "this column",
  "diagnostics.genericSemantic": "that semantic type",

  // Semantic evidence presentation. `kind` / `source` stay machine values in
  // Core; only this copy is localized. Raw Core fields remain reachable behind
  // the per-item "raw evidence" disclosure.
  "evidence.source.column_name": "Column name",
  "evidence.source.schema_type": "Schema type",
  "evidence.source.length": "Column length",
  "evidence.source.user_confirmed": "Confirmed mapping",
  "evidence.source.user_override": "User override",
  "evidence.source.unknown": "Evidence",
  "evidence.technicalSummary": "View raw evidence",
  "evidence.technical.kind": "Evidence kind",
  "evidence.technical.source": "Evidence source",
  "evidence.technical.observation": "Observation",
  "evidence.technical.explanation": "Raw Core explanation",
  "evidence.fallback.observation": "Not localized yet",
  "evidence.fallback.explanation": "SchemaSeed cannot explain this evidence in the current language yet. The raw Core evidence stays available behind “View raw evidence”.",
  "evidence.column_name_exact_alias.explanation": "The normalized column name exactly matches the known {semantic} alias",
  "evidence.column_name_alias_token.explanation": "The column name contains {semantic} as a separate alias token",
  "evidence.schema_type_compatible.explanation": "{schemaFamily} is compatible with the {semantic} semantic type",
  "evidence.schema_type_incompatible.explanation": "{schemaFamily} is not compatible with the {semantic} semantic type",
  "evidence.length_accommodates_marker.explanation": "The column length fits the Safe Synthetic {semantic} marker",
  "evidence.length_insufficient_for_marker.explanation": "The Safe Synthetic {semantic} marker needs at least {minimum} characters, but the column length is {length}",
  "evidence.semantic_override_confirmed.explanation": "The semantic mapping was explicitly confirmed",
  "evidence.semantic_override_applied.explanation": "The semantic type was explicitly overridden by the user",
  "evidence.semantic_left_unknown.explanation": "Semantic generation was explicitly left unknown",

  // Preview.
  "preview.title": "Preview",
  "preview.caption.waitingContext": "Waiting for a valid DBX TableContext",
  "preview.caption.waitingPlan": "Waiting for GenerationPlan",
  "preview.summary": "{rows} rows · seed {seed} · data language {locale} · {profile}",
  "preview.readonly": "READ ONLY",
  "preview.null": "NULL",

  // Workbench status line.
  "status.loading.metadata": "Loading metadata",
  "status.loading.generation": "Generating",
  "status.dirty": "Rules changed · Generate required",
  "status.ready": "Ready",
  "status.warning": "Warning · preview ready",
  "status.blocked": "Blocked",
  "status.error": "Error",
  "status.empty": "Empty",

  // Preview / export state line.
  "state.dirty": "Rules changed, so the previous Preview and Export are stale; generate the dataset again.",
  "state.loading.metadata": "Reading the current table metadata through the DBX Host API…",
  "state.loading.generation": "Building the GenerationPlan and generating the preview…",
  "state.blocked.metadataCapability": "This DBX runtime does not expose the Schema Metadata capability, so this table cannot be generated.",
  "state.blocked.plan": "The current GenerationPlan is blocked; no dataset is generated or exported. Resolve the blocking items in Diagnostics first.",
  "state.blocked.context": "The TableContext is invalid or its metadata is unavailable; reopen this Workbench from the DBX sidebar table context menu.",
  "state.error": "The Host API or Generation Runtime request failed.",
  "state.warning": "Preview is ready, but Core diagnostics contain warning / unsupported facts.",
  "state.ready": "Preview matches the current GenerationPlan; Export reuses the same dataset.",

  // Export.
  "export.csv": "Export CSV",
  "export.json": "Export JSON",
  "export.unavailable": "Export is available after a successful preview.",
  "export.ready": "Export reuses the same dataset as the current Preview.",
  "export.disabledHint": "Export stays disabled while Preview is unavailable or a blocking diagnostic is present.",
  "export.done": "{rows} rows · {format} · UTF-8",
  "export.failed": "Export failed: {code} · {message}",
  "export.error.export_blocked_plan": "The current GenerationPlan is blocked and cannot be exported.",
  "export.error.export_no_dataset": "Export needs a successfully generated preview of the current table.",
  "export.error.export_error": "Export failed.",

  // Errors surfaced by Workbench actions.
  "error.actionFailed": "Action rejected: {message}",

  // Safety and footer statements.
  "safety.notice": "Generated values are synthetic test data and are not sourced from real PII.",
  "footer.statement": "Production DBX Workbench · No fixture fallback · No second database connection · No database writes",

  // Locale switcher option labels (each language names itself).
  "uiLocale.zh-CN": "简体中文",
  "uiLocale.en-US": "English",
});

/**
 * Localized diagnostic presentation for every diagnostic code the Generation
 * Core, the Host provider and the Workbench controllers can emit. Keys are the
 * stable machine codes; only the human copy lives here.
 *
 * `level` optionally overrides which severity word is shown in the headline
 * (for example a non-blocking warning that is really a confirmation request).
 * `severity` and `blocking` never change: they remain Core-owned machine data.
 */
export const EN_US_DIAGNOSTICS = Object.freeze({
  table_context_invalid: {
    title: "The Workbench could not read the DBX TableContext",
    description: "The context passed by DBX is missing required table identity, so no metadata request is sent.",
    action: "Reopen this Workbench from the DBX sidebar table context menu of the table you want to generate.",
  },
  metadata_capability_unavailable: {
    title: "This DBX runtime does not expose Schema Metadata",
    description: "SchemaSeed needs the published DBX Schema Metadata Host API to read column facts. Without it no plan can be built.",
    action: "Upgrade DBX to a version that provides the Schema Metadata capability, then reopen this Workbench.",
  },
  metadata_connection_not_open: {
    title: "The DBX connection for this table is not open",
    description: "Metadata can only be read while the connection that owns the table is active.",
    action: "Reconnect the database in DBX, then reopen this Workbench from the table context menu.",
  },
  metadata_permission_denied: {
    title: "Metadata read permission was denied",
    description: "The DBX Host refused the metadata request, so column facts are unknown and generation cannot be proven safe.",
    action: "Check that the plugin permission host.schema:read is granted and that the current user may inspect this table.",
  },
  metadata_request_failed: {
    title: "Reading table metadata failed",
    description: "The DBX Host API request for this table did not complete, so SchemaSeed has no column facts to work with.",
    action: "Retry after the connection is healthy; if it keeps failing, check DBX logs for the host-side error.",
  },
  metadata_invalid_response: {
    title: "DBX returned unusable metadata",
    description: "The Host API response did not match the documented column metadata contract, so SchemaSeed rejected it instead of guessing.",
    action: "Report the DBX version and the raw response so the metadata contract can be re-verified.",
  },
  invalid_metadata_response: {
    title: "DBX returned unusable metadata",
    description: "The metadata response failed SchemaSeed validation and was refused rather than partially accepted.",
    action: "Re-run the read; if it persists, report the DBX version and raw response.",
  },
  schema_metadata_provider_failed: {
    title: "The schema metadata provider failed",
    description: "SchemaSeed could not turn the DBX metadata response into schema facts, so the plan is unavailable.",
    action: "Retry the read and report the raw response if the failure repeats.",
  },
  schema_metadata_provider_unavailable: {
    title: "No schema metadata provider is available",
    description: "The Workbench was started without a provider that can read the current DBX table.",
    action: "Reopen the Workbench from the DBX table context menu so the Host provider is wired in.",
  },
  invalid_schema: {
    title: "The table structure is not usable",
    description: "The received columns do not form a valid schema, so SchemaSeed cannot plan deterministic values.",
    action: "Verify the table is a regular table with named columns and re-read the metadata.",
  },
  duplicate_column_name: {
    title: "The table structure repeats a column name",
    description: "Two columns share one name, which makes generated data and export ambiguous.",
    action: "Fix the schema or the metadata response before generating data.",
  },
  varchar_length_unknown: {
    title: "The text column maximum length is unknown",
    description: "DBX did not return length information for column {column}, so SchemaSeed cannot prove that generated or manual values fit the column. It refuses to guess a maximum.",
    action: "Specify the allowed maximum length yourself, or re-read metadata once DBX returns complete column facts.",
  },
  decimal_precision_scale_unknown: {
    title: "The decimal precision or scale is unknown",
    description: "DBX did not return precision / scale for column {column}, so SchemaSeed cannot prove that generated decimals fit the column.",
    action: "Provide precision and scale, or re-read metadata once DBX returns complete column facts.",
  },
  timestamp_precision_unknown: {
    title: "The timestamp precision is unknown",
    description: "DBX did not return fractional-second precision for column {column}, so SchemaSeed cannot prove that generated timestamps fit the column.",
    action: "Re-read metadata once DBX returns precision for this column, or choose a generation rule that does not depend on it.",
  },
  invalid_length: {
    title: "The configured length is not a usable value",
    description: "A length must be a positive whole number; the given value cannot bound the generated output.",
    action: "Enter a positive integer length that is within the column capacity.",
  },
  invalid_precision_scale: {
    title: "The configured precision or scale is not usable",
    description: "Precision and scale must satisfy the schema bounds of this decimal column.",
    action: "Correct precision / scale to a value the column type can represent.",
  },
  invalid_nullable_fact: {
    title: "The nullability fact is contradictory",
    description: "The metadata claims a nullability state that cannot be interpreted, so SchemaSeed will not assume the column accepts NULL.",
    action: "Re-read metadata; report the raw response if the contradiction repeats.",
  },
  nullability_unknown: {
    title: "The column nullability is unknown",
    description: "DBX did not state whether column {column} accepts NULL, so SchemaSeed keeps generated values non-null to stay safe.",
    action: "No action needed unless you need NULL values; you can still add an explicit null ratio rule per column.",
  },
  nullability_rule_conflict: {
    title: "The null ratio conflicts with the column nullability",
    description: "A null ratio was requested for a column that the schema declares as NOT NULL, so no NULL value can be produced.",
    action: "Remove the null ratio for this column or correct the schema facts first.",
  },
  invalid_seed: {
    title: "The seed value is not usable",
    description: "The seed must be non-empty text; without it, regeneration cannot be reproduced.",
    action: "Provide a short text seed and generate again.",
  },
  invalid_row_count: {
    title: "The row count is out of range",
    description: "The requested number of rows is outside the range the Workbench accepts (1–100).",
    action: "Choose a row count between 1 and 100.",
  },
  invalid_locale: {
    title: "The data language is not supported",
    description: "The synthetic data language must be zh-CN or en. This setting only affects generated values, never the interface language.",
    action: "Pick zh-CN or en in the Data language control.",
  },
  invalid_override: {
    title: "The column override is not usable",
    description: "An override referenced a column that is not part of the current table schema, so it was rejected.",
    action: "Reload the table and re-apply the override for an existing column.",
  },
  invalid_constraint_config: {
    title: "The manual constraint is not valid",
    description: "A SchemaSeed generation constraint references columns or an ordering that the current table cannot satisfy.",
    action: "Review the constraint columns and ordering, then generate again.",
  },
  constraint_required_violation: {
    title: "A required-and-unique constraint cannot be satisfied",
    description: "The constraint demands values that are both non-null and unique, but the allocated value domain is too small.",
    action: "Raise the row count headroom (value domain) or relax the constraint.",
  },
  constraint_validation_invalid_input: {
    title: "The constraint validation request was rejected",
    description: "The constraint payload did not match the SchemaSeed constraint contract, so Core refused to validate it.",
    action: "Re-create the constraint from the editor instead of editing raw JSON.",
  },
  generation_rule_invalid: {
    title: "The generation rule is not valid",
    description: "The configured rule does not match the tagged generation rule contract for column {column}, so nothing was generated.",
    action: "Pick a compatible rule in the Rule Editor and verify each field value.",
  },
  generation_rule_incompatible: {
    title: "The generation rule does not fit this column",
    description: "The configured rule can produce values outside the column schema for {column}, so SchemaSeed refuses to generate rather than truncate silently.",
    action: "Restore the schema-derived values in the Rule Editor, or pick another rule.",
  },
  generation_rule_conflict: {
    title: "Two generation settings conflict",
    description: "A semantic rule and a semantic mapping for the same column disagree, so no single generator can be chosen.",
    action: "Keep one of the two settings and remove the other, then generate again.",
  },
  generation_sequence_overflow: {
    title: "The sequence cannot produce enough distinct values",
    description: "The configured start / step range runs out before the requested number of rows is reached.",
    action: "Lower the row count, widen the step, or use a different rule.",
  },
  semantic_confirmation_required: {
    title: "This column semantic is ambiguous",
    description: "{column} looks like it holds {semantic}, but the evidence is not strong enough to confirm it. SchemaSeed keeps the plain schema-type generator for now.",
    action: "If the column really holds {semantic}, confirm the semantic manually in Generator / Semantic Mapping.",
    level: "needs_confirmation",
  },
  semantic_low_confidence: {
    title: "This column semantic has weak evidence",
    description: "Only the column name hints at {semantic} for {column}, so SchemaSeed keeps the schema-type fallback instead of a semantic generator.",
    action: "Confirm the semantic manually if the guess is right; otherwise leave the fallback in place.",
  },
  semantic_ambiguous: {
    title: "Several semantics match this column",
    description: "More than one semantic candidate matches {column}, so SchemaSeed will not pick one on its own.",
    action: "Choose the intended semantic explicitly, or keep the plain schema-type generator.",
  },
  semantic_override_invalid: {
    title: "The semantic override is not usable",
    description: "The requested semantic is not one of the supported SchemaSeed semantics, so it was rejected instead of silently ignored.",
    action: "Pick one of the offered semantics for this column.",
  },
  unsupported_semantic_type: {
    title: "This semantic type is not supported",
    description: "SchemaSeed has no generator for the requested semantic, so the plan cannot use it.",
    action: "Pick a supported semantic or keep the schema-type generator.",
  },
  semantic_schema_incompatible: {
    title: "This semantic does not fit the column type",
    description: "The detected semantic cannot be represented safely with the column type of {column}, so the schema-type fallback is kept.",
    action: "If the semantic is wrong, ignore this; otherwise change the column type or the generation rule.",
  },
  safe_synthetic_mode: {
    title: "Safe synthetic mode is active",
    description: "Values are produced only from schema facts and the deterministic generator; no real row data is read.",
  },
  validator_mode_unsupported: {
    title: "The requested validation mode is not supported",
    description: "Core only supports validation in safe synthetic mode, so the request was refused.",
    action: "Remove the unsupported mode option and retry.",
  },
  generation_impossible: {
    title: "No value can satisfy this column",
    description: "The schema bounds and the configured rule leave an empty value domain for {column}.",
    action: "Relax the rule bounds or correct the schema facts so at least one value fits.",
  },
  invalid_generation_plan: {
    title: "The GenerationPlan is not valid",
    description: "The plan failed its own contract checks, so SchemaSeed will neither generate nor export from it.",
    action: "Re-generate the plan; report the diagnostics if the plan stays invalid.",
  },
  generation_runtime_failed: {
    title: "The generation runtime failed",
    description: "The Generation Core request did not complete, so no dataset was produced for this table.",
    action: "Retry; if it keeps failing, check the DBX plugin runtime logs.",
  },
});
