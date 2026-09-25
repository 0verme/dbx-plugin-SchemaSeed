/**
 * zh-CN message catalog. The key set must stay identical to `en-US.mjs`;
 * `tests/i18n.test.mjs` fails when a key is missing on either side.
 *
 * The copy is written for Chinese readers rather than translated word by word.
 * Product names (SchemaSeed, DBX, CSV, JSON, UUID, NULL, GenerationPlan) and
 * technical identifiers stay as they are.
 */
export const ZH_CN_MESSAGES = Object.freeze({
  // Application shell.
  "app.titleSuffix": "测试数据生成",
  "app.subtitle": "基于当前表结构生成测试数据",
  "app.boot.connecting": "正在连接 DBX Plugin Host…",
  "app.boot.bridgeUnavailable": "DBX Plugin Host bridge 不可用。",
  "app.boot.failed": "SchemaSeed 初始化失败：{message}",

  // Table context.
  "context.title": "当前表",
  "context.caption": "直接使用 DBX 传入的表上下文；database / schema 可选",
  "context.database": "数据库",
  "context.schema": "Schema",
  "context.table": "数据表",

  // Dataset controls.
  "controls.rows": "生成行数",
  "controls.rowsRange": "1–100",
  "controls.seed": "随机种子",
  "controls.dataLocale": "数据语言",
  "controls.localeNote": "“界面语言”只改变界面文字；“数据语言”（zh-CN / en）只影响生成值的语言形态。两者互不影响。",
  "controls.uiLocale": "界面语言",

  // Primary actions.
  "actions.generate": "生成预览",
  "actions.regenerateSameSeed": "使用相同种子重新生成",
  "actions.newSeed": "更换种子",

  // Column / strategy table.
  "columns.title": "字段与当前生成策略",
  "columns.caption": "生成策略、语义识别与证据来自当前 GenerationPlan",
  "columns.header.column": "字段名",
  "columns.header.schemaType": "字段类型",
  "columns.header.strategy": "生成策略 / 语义识别",
  "columns.header.mappingStatus": "识别状态",
  "columns.header.rules": "规则 / 诊断",
  "columns.strategyDetail": "{source} · 识别为 {detected}（{confidence}）",
  "columns.empty.loading": "正在读取表结构…",
  "columns.empty.none": "暂无可展示的字段。",
  "columns.evidenceSummary": "{count} 条识别证据",
  "columns.evidenceItem": "{source}：{observation} —— {explanation}",
  "columns.ruleDiagnostic": "{title}",
  "columns.ruleSelectLabel": "{column} 的生成策略",
  "columns.none": "—",

  // Rule editor state line.
  "ruleEditor.state.loading": "请先打开一个 DBX 表，再编辑生成规则。",
  "ruleEditor.state.validating": "正在由 Core 校验新规则；校验期间预览与导出不可用。",
  "ruleEditor.state.generating": "正在重建 GenerationPlan 与数据集…",
  "ruleEditor.state.error": "Host 或 Generation Runtime 请求失败，规则编辑器暂不可用。",
  "ruleEditor.state.dirty": "规则已通过校验，但预览已过期；请重新生成。",
  "ruleEditor.state.blocked": "存在规则或表结构问题，暂时无法生成或导出；请先处理这些问题。",
  "ruleEditor.state.warning": "规则可用，但 Core 返回了警告；预览仍可查看。",
  "ruleEditor.state.ready": "规则只保存在当前表的本次会话中；修改任何规则都会让预览与导出失效。",

  // Generation rule names.
  "ruleKind.auto": "自动（按字段类型）",
  "ruleKind.constant": "固定值",
  "ruleKind.sequence": "递增序列",
  "ruleKind.random_integer": "随机整数",
  "ruleKind.random_decimal": "随机小数",
  "ruleKind.random_string": "随机字符串",
  "ruleKind.enum": "枚举值",
  "ruleKind.boolean_ratio": "布尔比例",
  "ruleKind.date_range": "日期范围",
  "ruleKind.timestamp_range": "时间戳范围",
  "ruleKind.uuid": "UUID",
  "ruleKind.null_ratio": "空值比例",
  "ruleKind.semantic": "语义生成",

  // Effective generator for schema-type fallbacks.
  "generatorKind.integer": "整数",
  "generatorKind.decimal": "小数",
  "generatorKind.varchar": "文本",
  "generatorKind.string": "文本",
  "generatorKind.boolean": "布尔",
  "generatorKind.date": "日期",
  "generatorKind.timestamp": "时间戳",
  "generatorKind.uuid": "UUID",
  "generatorKind.unsupported": "不支持的策略",
  "generatorKind.unknown": "未识别",

  // Source of the effective generation rule reported by the Core.
  "ruleSource.auto": "自动",
  "ruleSource.schema_type_fallback": "按字段类型",
  "ruleSource.explicit_user_rule": "手动规则",
  "ruleSource.explicit_user_semantic_override": "手动指定语义",
  "ruleSource.confirmed_semantic_mapping": "已确认的语义",

  // Rule editor field labels.
  "ruleField.value": "固定值（JSON 标量）",
  "ruleField.start": "起始值",
  "ruleField.step": "步长",
  "ruleField.min": "最小值",
  "ruleField.max": "最大值",
  "ruleField.length": "长度",
  "ruleField.values": "候选值（JSON 数组）",
  "ruleField.trueRatio": "true 比例（0–1）",
  "ruleField.ratio": "空值比例（0–1）",
  "ruleField.semanticType": "语义类型",
  "ruleField.date_range.start": "起始日期",
  "ruleField.date_range.end": "结束日期",
  "ruleField.timestamp_range.start": "起始时间（UTC）",
  "ruleField.timestamp_range.end": "结束时间（UTC）",

  // Schema type state words (raw DB types are never translated).
  "schemaType.state.unknown": "未知类型",
  "schemaType.state.absent": "未提供",
  "schemaType.state.not_applicable": "不适用",

  // Mapping status: presentation only, the Core enum is unchanged.
  "mappingStatus.explicit": "手动指定 · {kind}",
  "mappingStatus.confirmed": "已确认",
  "mappingStatus.override": "手动指定",
  "mappingStatus.confirmedIncompatible": "已确认的语义与字段类型不兼容 · 当前使用默认策略",
  "mappingStatus.overrideIncompatible": "手动指定的语义与字段类型不兼容 · 当前使用默认策略",
  "mappingStatus.needsConfirmation": "待确认 · 当前使用默认策略",
  "mappingStatus.ambiguous": "存在多个候选 · 当前使用默认策略",
  "mappingStatus.incompatible": "与字段类型不兼容 · 当前使用默认策略",
  "mappingStatus.fallback": "默认策略",

  "confidence.high": "高可信度",
  "confidence.medium": "中等可信度",
  "confidence.low": "低可信度",
  "confidence.unknown": "可信度未知",

  "semantic.unknown": "未识别",
  "semantic.name": "姓名",
  "semantic.gender": "性别",
  "semantic.birthday": "生日",
  "semantic.mobile": "手机号",
  "semantic.email": "邮箱",
  "semantic.address": "地址",
  "detected.ambiguous": "多个候选：{candidates}",

  // Constraints.
  "constraints.title": "生成约束",
  "constraints.caption": "只作用于 SchemaSeed 的数据生成，不是数据库约束元数据。",
  "constraints.add": "+ 添加约束",
  "constraints.header.kind": "类型",
  "constraints.header.columns": "字段（组合约束按顺序）",
  "constraints.header.plan": "可行性 / 容量",
  "constraints.header.actions": "",
  "constraints.empty.noTable": "请先打开一个 DBX 表，再配置生成约束。",
  "constraints.empty.none": "暂未配置生成约束。",
  "constraints.kind.unique": "唯一",
  "constraints.kind.composite_unique": "组合唯一",
  "constraints.kind.required_unique": "非空且唯一",
  "constraints.delete": "删除",
  "constraints.columnsAriaLabel": "{id} 的组合字段顺序（JSON 数组）",
  "constraints.plan.pending": "等待 Core 校验",
  "constraints.plan.ready": "{satisfiable} · 容量 {capacity}{blocked}",
  "constraints.plan.blockedSuffix": " · 阻塞",
  "constraints.satisfiable.yes": "可满足",
  "constraints.satisfiable.no": "无法满足",
  "constraints.satisfiable.unknown": "无法证明",
  "constraints.capacity.unknown": "未知 / 无法证明",
  "constraints.state.loading": "请先打开一个 DBX 表，再编辑生成约束。",
  "constraints.state.validating": "正在由 Core 校验生成约束；校验期间预览与导出不可用。",
  "constraints.state.dirty": "生成约束已通过校验，但预览已过期；请重新生成。",
  "constraints.state.blocked": "生成约束或规则存在冲突，暂时无法生成或导出数据；请查看“问题诊断”。",
  "constraints.state.error": "生成约束校验失败。",
  "constraints.state.ready": "生成约束是明确的 SchemaSeed 生成要求，只作用于当前表的本次会话。",
  "constraints.state.warning": "生成约束可用，但 Core 返回了警告；预览仍可查看。",

  // Diagnostics.
  "diagnostics.title": "问题诊断",
  "diagnostics.caption": "复用 Host Provider / Generation Core 的诊断信息，并按当前界面语言显示",
  "diagnostics.empty.loading": "正在加载…",
  "diagnostics.empty.blocked": "当前没有可展示的诊断详情，但生成仍被阻塞。",
  "diagnostics.empty.error": "Host 或 runtime 请求失败。",
  "diagnostics.empty.warning": "Core 返回了警告；可以查看字段级诊断。",
  "diagnostics.empty.none": "没有 Core 诊断信息。",
  "diagnostics.headline": "{level}：{title}",
  "diagnostics.level.blocking": "阻塞",
  "diagnostics.level.warning": "警告",
  "diagnostics.level.error": "错误",
  "diagnostics.level.unsupported": "不支持",
  "diagnostics.level.needs_confirmation": "需要确认",
  "diagnostics.actionLabel": "处理建议：",
  "diagnostics.technicalSummary": "查看技术详情",
  "diagnostics.technical.code": "诊断代码",
  "diagnostics.technical.severity": "严重级别",
  "diagnostics.technical.blocking": "是否阻塞",
  "diagnostics.technical.table": "表",
  "diagnostics.technical.column": "字段",
  "diagnostics.technical.rule": "规则",
  "diagnostics.technical.reason": "Core 原始消息",
  "diagnostics.technical.yes": "是",
  "diagnostics.technical.no": "否",
  "diagnostics.fallback.title": "未分类诊断（{code}）",
  "diagnostics.fallback.description": "Core 返回了当前界面尚未本地化的诊断代码。原始技术信息：{reason}",
  "diagnostics.genericColumn": "该字段",
  "diagnostics.genericSemantic": "该语义",

  // 语义识别证据展示。`kind` / `source` 仍为 Core 的 machine 值，
  // 这里只本地化用户文案；原始 Core 字段仍可在每条证据的“查看原始证据”中查看。
  "evidence.source.column_name": "字段名",
  "evidence.source.schema_type": "字段类型",
  "evidence.source.length": "字段长度",
  "evidence.source.user_confirmed": "已确认映射",
  "evidence.source.user_override": "用户指定覆盖",
  "evidence.source.unknown": "识别证据",
  "evidence.technicalSummary": "查看原始证据",
  "evidence.technical.kind": "证据类型",
  "evidence.technical.source": "证据来源",
  "evidence.technical.observation": "原始观察值",
  "evidence.technical.explanation": "Core 原始解释",
  "evidence.fallback.observation": "尚未本地化",
  "evidence.fallback.explanation": "当前语言暂时无法解释这条识别证据；原始 Core 证据可在“查看原始证据”中查看。",
  "evidence.column_name_exact_alias.explanation": "字段名规范化后与已知的「{semantic}」别名完全一致",
  "evidence.column_name_alias_token.explanation": "字段名中包含独立的「{semantic}」语义别名",
  "evidence.schema_type_compatible.explanation": "{schemaFamily} 类型与「{semantic}」语义兼容",
  "evidence.schema_type_incompatible.explanation": "{schemaFamily} 类型与「{semantic}」语义不兼容",
  "evidence.length_accommodates_marker.explanation": "字段长度可以容纳 Safe Synthetic「{semantic}」测试标记",
  "evidence.length_insufficient_for_marker.explanation": "Safe Synthetic「{semantic}」测试标记至少需要 {minimum} 个字符，而字段长度为 {length}",
  "evidence.semantic_override_confirmed.explanation": "语义映射已由用户显式确认",
  "evidence.semantic_override_applied.explanation": "语义类型已由用户显式覆盖",
  "evidence.semantic_left_unknown.explanation": "已显式选择不启用语义生成",

  // Preview.
  "preview.title": "数据预览",
  "preview.caption.waitingContext": "等待有效的 DBX 表上下文",
  "preview.caption.waitingPlan": "等待 GenerationPlan",
  "preview.summary": "{rows} 行 · 随机种子 {seed} · 数据语言 {locale} · {profile}",
  "preview.readonly": "只读",
  "preview.null": "NULL",

  // Workbench status line.
  "status.loading.metadata": "正在读取表结构",
  "status.loading.generation": "正在生成",
  "status.dirty": "规则已变更 · 需重新生成",
  "status.ready": "就绪",
  "status.warning": "警告 · 预览可用",
  "status.blocked": "无法生成",
  "status.error": "错误",
  "status.empty": "暂无数据",

  // Preview / export state line.
  "state.dirty": "规则已更新，旧的预览与导出已失效；请重新生成当前规则的数据。",
  "state.loading.metadata": "正在通过 DBX Host API 读取当前表结构…",
  "state.loading.generation": "正在构建 GenerationPlan 并生成预览…",
  "state.blocked.metadataCapability": "当前 DBX runtime 未提供 Schema Metadata 能力，因此无法为这张表生成数据。",
  "state.blocked.plan": "当前存在阻塞问题，暂时无法生成或导出测试数据。请先处理上方“问题诊断”中的阻塞项。",
  "state.blocked.context": "表上下文无效或表结构不可用；请从 DBX 侧边栏的表右键菜单重新打开本工作台。",
  "state.error": "Host API 或 Generation Runtime 请求失败。",
  "state.warning": "预览已生成，但 Core 诊断中包含警告或不支持的事实。",
  "state.ready": "预览与当前 GenerationPlan 一致；导出的数据与预览完全相同。",

  // Export.
  "export.csv": "导出 CSV",
  "export.json": "导出 JSON",
  "export.unavailable": "生成预览成功后才可导出。",
  "export.ready": "导出的数据与当前预览完全相同。",
  "export.disabledHint": "预览不可用或存在阻塞诊断时，导出保持禁用。",
  "export.done": "{rows} 行 · {format} · UTF-8",
  "export.failed": "导出失败：{code} · {message}",
  "export.error.export_blocked_plan": "当前 GenerationPlan 被阻塞，无法导出。",
  "export.error.export_no_dataset": "导出需要先成功生成当前表的数据预览。",
  "export.error.export_error": "导出失败。",

  // Errors surfaced by Workbench actions.
  "error.actionFailed": "操作未生效：{message}",

  // Safety and footer statements.
  "safety.notice": "生成的数据均为合成测试数据，不来源于真实个人信息。",
  "footer.statement": "Production DBX Workbench · 不使用 fixture 兜底 · 不建立第二条数据库连接 · 不写入数据库",

  // Locale switcher option labels (each language names itself).
  "uiLocale.zh-CN": "简体中文",
  "uiLocale.en-US": "English",
});

/**
 * zh-CN diagnostic presentation. Titles, meanings and suggested actions are
 * written for a user who does not know SchemaSeed internals; the technical
 * evidence stays available in the collapsible detail section.
 */
export const ZH_CN_DIAGNOSTICS = Object.freeze({
  table_context_invalid: {
    title: "无法读取 DBX 传入的表上下文",
    description: "DBX 传入的上下文缺少必要的表标识，因此 SchemaSeed 不会发出表结构读取请求。",
    action: "请从 DBX 侧边栏中该表的右键菜单重新打开本工作台。",
  },
  metadata_capability_unavailable: {
    title: "当前 DBX 未提供 Schema Metadata 能力",
    description: "SchemaSeed 需要 DBX 公开的 Schema Metadata Host API 才能读取字段信息；缺少它就无法制定生成计划。",
    action: "请升级到提供 Schema Metadata 能力的 DBX 版本，然后重新打开本工作台。",
  },
  metadata_connection_not_open: {
    title: "该表所属的 DBX 连接未打开",
    description: "只有在表所属连接处于活动状态时才能读取表结构。",
    action: "请在 DBX 中重新连接该数据库，然后从表的右键菜单重新打开本工作台。",
  },
  metadata_permission_denied: {
    title: "读取表结构的权限被拒绝",
    description: "DBX Host 拒绝了对该表的 metadata 请求，SchemaSeed 无法确认字段事实，因此不会继续生成。",
    action: "请确认插件权限 host.schema:read 已授予，且当前用户有权查看该表。",
  },
  metadata_request_failed: {
    title: "读取表结构失败",
    description: "针对该表的 DBX Host API 请求没有完成，SchemaSeed 没有可用的字段信息。",
    action: "请在连接恢复后重试；若持续失败，可查看 DBX 日志中的 host 侧错误。",
  },
  metadata_invalid_response: {
    title: "DBX 返回的表结构信息无法使用",
    description: "Host API 的返回内容不符合公开的字段 metadata 契约，SchemaSeed 选择拒绝而不是猜测。",
    action: "请记录 DBX 版本与原始返回内容，以便重新核对 metadata 契约。",
  },
  invalid_metadata_response: {
    title: "DBX 返回的表结构信息无法使用",
    description: "返回内容未通过 SchemaSeed 校验，因此被整体拒绝，而不是部分接受。",
    action: "请重新读取；若问题持续，请记录 DBX 版本与原始返回内容。",
  },
  schema_metadata_provider_failed: {
    title: "表结构 provider 处理失败",
    description: "SchemaSeed 无法把 DBX 返回的 metadata 转换为可用的表结构事实，因此没有生成计划。",
    action: "请重试读取；若持续失败，请报告原始返回内容。",
  },
  schema_metadata_provider_unavailable: {
    title: "没有可用的表结构 provider",
    description: "工作台启动时没有接入能够读取当前 DBX 表的 provider。",
    action: "请从 DBX 表右键菜单重新打开工作台，让 Host provider 正常接入。",
  },
  invalid_schema: {
    title: "表结构不可用",
    description: "收到的字段无法构成有效的表结构，SchemaSeed 无法规划确定性取值。",
    action: "请确认该对象是带字段名的普通表，然后重新读取表结构。",
  },
  duplicate_column_name: {
    title: "表结构中存在重名字段",
    description: "两个字段使用同一个名称，生成的数据与导出结果会产生歧义。",
    action: "请修正表结构或 metadata 返回内容后再生成数据。",
  },
  varchar_length_unknown: {
    title: "无法确认文本字段的最大长度",
    description: "DBX 没有返回「{column}」字段的长度信息，SchemaSeed 无法确认生成值是否超出字段容量，因此不会猜测一个最大长度。",
    action: "请手动指定允许的最大长度，或在 DBX 返回完整字段元数据后重新读取。",
  },
  decimal_precision_scale_unknown: {
    title: "无法确认小数字段的精度或小数位",
    description: "DBX 没有返回「{column}」字段的 precision / scale，SchemaSeed 无法确认生成的小数是否超出字段容量。",
    action: "请手动提供 precision 与 scale，或在 DBX 返回完整字段信息后重新读取。",
  },
  timestamp_precision_unknown: {
    title: "无法确认时间戳字段的精度",
    description: "DBX 没有返回「{column}」字段的小数秒精度，SchemaSeed 无法确认生成的时间戳是否超出字段容量。",
    action: "请在 DBX 返回该字段精度后重新读取，或改用不依赖该精度的生成策略。",
  },
  invalid_length: {
    title: "配置的长度不是有效值",
    description: "长度必须是正整数；当前取值无法约束生成结果。",
    action: "请输入一个在该字段容量范围内的正整数长度。",
  },
  invalid_precision_scale: {
    title: "配置的精度或小数位不可用",
    description: "precision 与 scale 必须符合该小数字段允许的范围。",
    action: "请把 precision / scale 调整为该字段类型可以表示的值。",
  },
  invalid_nullable_fact: {
    title: "可空性信息自相矛盾",
    description: "metadata 中的可空状态无法解释，SchemaSeed 不会假设该字段可以存放 NULL。",
    action: "请重新读取表结构；若矛盾持续出现，请报告原始返回内容。",
  },
  nullability_unknown: {
    title: "无法确认字段是否允许为空",
    description: "DBX 没有说明「{column}」字段是否允许 NULL，SchemaSeed 为保证安全继续生成非空值。",
    action: "如果不需要 NULL，可以忽略此提示；如确实需要，可为该字段显式设置空值比例规则。",
  },
  nullability_rule_conflict: {
    title: "空值比例与字段可空性冲突",
    description: "该字段在表结构中被声明为 NOT NULL，因此无法按要求生成 NULL 值。",
    action: "请移除该字段的空值比例，或先修正表结构信息。",
  },
  invalid_seed: {
    title: "随机种子不可用",
    description: "随机种子必须是非空文本，否则无法复现相同的生成结果。",
    action: "请输入一个简短的文本种子后重新生成。",
  },
  invalid_row_count: {
    title: "生成行数超出范围",
    description: "请求的行数不在工作台允许的范围（1–100）内。",
    action: "请把行数设置在 1 到 100 之间。",
  },
  invalid_locale: {
    title: "不支持该数据语言",
    description: "synthetic 数据语言只能是 zh-CN 或 en。该设置只影响生成值，与界面语言无关。",
    action: "请在“数据语言”中选择 zh-CN 或 en。",
  },
  invalid_override: {
    title: "字段覆盖配置不可用",
    description: "覆盖配置引用了当前表中不存在的字段，因此被拒绝。",
    action: "请重新打开该表，并为存在的字段重新设置覆盖配置。",
  },
  invalid_constraint_config: {
    title: "生成约束配置无效",
    description: "某个 SchemaSeed 生成约束引用了当前表无法满足的字段或顺序。",
    action: "请检查约束的字段与顺序，然后重新生成。",
  },
  constraint_required_violation: {
    title: "“非空且唯一”约束无法满足",
    description: "该约束要求取值既非空又唯一，但可用的取值空间不足。",
    action: "请增大取值空间（例如调整行数上限）或放宽该约束。",
  },
  constraint_validation_invalid_input: {
    title: "约束校验请求被拒绝",
    description: "约束内容不符合 SchemaSeed 的约束契约，Core 拒绝继续校验。",
    action: "建议通过界面重新创建该约束，而不是手工编辑原始 JSON。",
  },
  generation_rule_invalid: {
    title: "生成规则无效",
    description: "为「{column}」字段配置的规则不符合生成规则契约，因此没有生成任何数据。",
    action: "请在规则编辑器中选择兼容的生成策略，并检查各字段取值。",
  },
  generation_rule_incompatible: {
    title: "生成策略与字段不匹配",
    description: "为「{column}」配置的策略可能产生超出字段容量的值，SchemaSeed 选择拒绝生成，而不是静默截断。",
    action: "请在规则编辑器中恢复按表结构推导的取值，或改用其他策略。",
  },
  generation_rule_conflict: {
    title: "两项生成设置互相冲突",
    description: "同一字段上的语义规则与语义映射不一致，无法确定使用哪一个生成器。",
    action: "请保留其中一项设置并移除另一项，然后重新生成。",
  },
  generation_sequence_overflow: {
    title: "序列无法提供足够多的不同取值",
    description: "按当前起始值 / 步长计算，序列在达到所需行数之前就会耗尽。",
    action: "请减少行数、增大步长，或改用其他生成策略。",
  },
  semantic_confirmation_required: {
    title: "字段语义存在歧义",
    description: "「{column}」被识别为「{semantic}」候选，但当前证据不足以确认。SchemaSeed 暂时仍使用普通文本生成策略。",
    action: "如果该字段确实表示{semantic}，请在“生成策略 / 语义识别”中手动确认其语义。",
    level: "needs_confirmation",
  },
  semantic_low_confidence: {
    title: "字段语义证据不足",
    description: "「{column}」只有字段名暗示它表示「{semantic}」，可信度较低，SchemaSeed 暂时保留按字段类型生成的策略。",
    action: "如果判断正确，可以手动确认该语义；否则保持默认策略即可。",
  },
  semantic_ambiguous: {
    title: "该字段匹配到多个语义",
    description: "「{column}」同时匹配多个语义候选，SchemaSeed 不会自行选择其中一个。",
    action: "请显式指定需要的语义，或继续使用按字段类型生成的策略。",
  },
  semantic_override_invalid: {
    title: "指定的语义不可用",
    description: "请求的语义不在 SchemaSeed 支持的范围内，因此被拒绝，而不是被静默忽略。",
    action: "请在该字段提供的语义列表中选择一个。",
  },
  unsupported_semantic_type: {
    title: "不支持该语义类型",
    description: "SchemaSeed 没有为请求的语义提供生成器，因此计划无法使用它。",
    action: "请选择受支持的语义，或继续使用按字段类型生成的策略。",
  },
  semantic_schema_incompatible: {
    title: "该语义与字段类型不兼容",
    description: "识别出的语义无法用「{column}」的字段类型安全表示，因此继续使用按字段类型生成的策略。",
    action: "如果语义识别有误可以忽略；否则请调整字段类型或生成策略。",
  },
  safe_synthetic_mode: {
    title: "当前处于安全合成模式",
    description: "所有取值只来自表结构与确定性生成器，不会读取任何真实数据行。",
  },
  validator_mode_unsupported: {
    title: "不支持该校验模式",
    description: "Core 只支持在安全合成模式下校验，因此该请求被拒绝。",
    action: "请移除不支持的 mode 选项后重试。",
  },
  generation_impossible: {
    title: "该字段无法生成任何取值",
    description: "表结构边界与当前规则叠加后，为「{column}」留下的可用取值空间为空。",
    action: "请放宽规则取值范围，或修正表结构信息，使至少有一个取值可用。",
  },
  invalid_generation_plan: {
    title: "GenerationPlan 无效",
    description: "生成计划未通过自身的契约检查，SchemaSeed 不会用它生成或导出数据。",
    action: "请重新生成计划；若仍然无效，请报告相关诊断信息。",
  },
  generation_runtime_failed: {
    title: "生成运行时失败",
    description: "Generation Core 请求没有完成，因此这张表没有生成任何数据集。",
    action: "请重试；若持续失败，请查看 DBX 插件运行时日志。",
  },
});
