# Issue #84：P0 工作台现状基线与 P1 窄屏布局校准

- Issue：[#84](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/84)
- P1 子 Issue：[#85](https://github.com/0verme/dbx-plugin-SchemaSeed/issues/85)
- Draft PR：[#86](https://github.com/0verme/dbx-plugin-SchemaSeed/pull/86)（等待真机 UI 验收，暂不合并）
- 代码基线：`origin/main` / `997c041f8f6833430d3d2bf835b06da70a30e758`（2026-10-09）
- 范围：只审计并调整现有生产 Workbench 的上下文、参数与操作区；不实施 P2–P5，不引入 Faker/Chance。

## 1. 审计范围与历史去重

- 阅读了 #84 既有审计、生产 Workbench markup/CSS、ViewModel、DBX Controller/Adapter、相关测试与运行时说明。
- **PR #49 已实现的内容不重复做：**预览常开并在高级区前显示；字段/策略、约束和诊断默认折叠；折叠摘要及新 blocking 诊断自动展开。
- **PR #76 已实现的内容不重复做：**INSERT SQL 作为只读、默认隐藏的预览入口；通过当前 `ExportDataset` 的既有 SQL export 路径生成，不新增序列化器或数据库写入。
- 对照当前 HEAD（含 PR #83）检查后，现有 UI 顺序仍为：顶栏 → 当前表/参数/操作 → 数据 Preview → 字段/策略 → 约束 → 诊断。

## 2. P0：当前 UI 基线

### 生产 UI、ViewModel 与 Controller

| 层 | 位置 | 当前职责/证据 |
|---|---|---|
| Markup 与交互 | `ui/generation-workbench/app.mjs` | `WORKBENCH_MARKUP` 定义五个页面 section。上下文卡包含 DBX table context、数据访问说明、行数/seed/数据 locale、生成/同 seed 重放/新 seed 操作。Preview 区含状态/安全提示、CSV/JSON/INSERT SQL 保存按钮、次级 SQL preview、结果表。高级区保留字段规则、采样提示、手动约束和诊断。 |
| 样式与滚动 | `ui/generation-workbench.css` | 桌面主要布局；断点为 1050px 与 640px。Preview 表格/字段表/约束表使用独立 `overflow:auto` 容器；Preview 表没有固定高度，因此目前无源码证据表明它会截成固定高度的纵向嵌套滚动区。INSERT SQL 文本框有 `max-height:45vh` 和自身滚动。窄屏时 Preview 及高级表格允许水平滚动。 |
| ViewModel | `src/workbench/workbench-view-model.mjs`、`src/workbench/workbench-sections.mjs` | 将 Core 列计划转换为展示模型；section 摘要来自当前字段/诊断/约束模型，不在 UI 重复推断。Preview 默认展开；高级区折叠策略、warning 摘要、blocking 诊断自动展开均已存在。 |
| 生产 Controller/Adapter | `src/workbench/dbx-generation-workbench-controller.mjs`、`src/workbench/dbx-generation-workbench-adapter.mjs` | 控制默认参数（20 行、`demo`、`zh-CN`）、状态、DBX Host metadata/授权采样、Core Preview、单一当前数据集及 CSV/JSON/SQL descriptor。UI locale 与数据 locale 分离；导出不重新生成。 |

### 首屏、参数、操作和预览

- **默认可见顺序：**Header 状态 → 数据库/schema/table → 数据访问说明 → 行数（1–100）/seed/数据 locale → 三个生成操作 → locale 注释 → Preview 标题/状态/安全提示/导出入口/Preview table。页面不要求用户先展开高级配置。
- **按钮层级：**「生成预览」已有 primary 样式；同 seed 重放和更换 seed 是次级按钮。CSV、JSON、INSERT SQL 保存及 SQL preview 入口位于 Preview 区；无可导出数据时禁用，Host 保存仍走 DBX 原生 API。
- **错误与滚动：**顶栏和 Preview 状态分别反映工作台状态/用户提示；动作失败有 `role=alert` 行内消息；阻塞/运行错误有诊断摘要且首次出现时自动展开诊断。表格可横向滚动；代码未给 Preview 表容器设置固定高度。
- **信息密度问题（源码事实，不是实测体验结论）：**640px 以下原上下文三格变为纵向单列；参数变为两列。窄屏上表头、状态说明、采样说明、locale 提示与按钮会增加上下文卡高度，因而 Preview 更晚出现在页面纵向流中。主区、上下文格与说明区的留白也有小幅压缩空间。

### 自动/人工测量边界

- 环境检查：没有安装 Playwright/Puppeteer/jsdom/happy-dom，也没有可用 Chromium/Firefox/WebKit 可执行文件；项目当前没有 viewport screenshot/geometry 自动化 harness。故本轮**没有伪称完成浏览器量测**。
- 仓库原有 `assets/screenshots/workbench-preview.png` 文件为 **1589×1040**；它是旧截图，画面未包含 PR #76 新增的 SQL preview 按钮。该图片仅是历史视觉参考，不作为当前代码的首屏高度、按钮可见性或可见行数基线；本轮未生成或冒充新截图。
- 下列目标 viewport 的 DOM 几何、首屏 CTA/Preview/导出入口及首行可见性均为 **PENDING 自动浏览器量测**：`1280×720`、`1366×768`、`1920×1080`、`390×844`。无法在现有环境直接测量，未填估算值。
- 当前 frontend-only universal 包在 DBX Desktop **Windows/macOS 真机验收均为 PENDING**；本轮没有 DBX Desktop，也没有制作实测截图。桌面窗口、WebView 字体/主题、键盘焦点、长标识符换行及错误状态下的滚动行为需要真机验收。

## 3. P1：变更与证据

### 变更前后（只涉及 CSS 排列）

| 项目 | 变更前 | 变更后 |
|---|---|---|
| 页面/卡片密度 | 主区间距 12px、上下 padding 14px；卡片 padding 14px | 主区 gap 10px、top padding 12px；卡片 padding 12px。缩短配置卡与 Preview 之间的纵向占用，不改变 section 顺序。 |
| TableContext | 窄于 640px 时 database/schema/table 由三列改为三行 | 窄屏保持三格并排；缩小格间距/padding，名称仍可换行。 |
| 参数 | 窄屏两列，locale 需另起一行 | 窄屏改为行数/seed/数据 locale 三列，允许输入框缩窄；仍保留原参数和默认值。 |
| 操作 | 窄屏按钮同组弹性换行，主按钮只依赖原有颜色层级 | Generate 主按钮占满一行；同 seed/新 seed 在下一行并列，按钮文字允许换行。所有操作均保留。 |
| Preview / 高级功能 | Preview 默认展开；高级区已折叠 | 完全不变。未改 markup、ViewModel、Controller、Generation Core、seed、采样/授权、安全策略、数据集或 Preview/Export 契约。 |

布局变更仅用现有 `ui/generation-workbench.css`；没有新增 UI 框架或运行时依赖。新增回归测试检查上下文/参数/三种操作仍存在、Generate 的 primary 语义、窄屏网格约定、数据访问说明保留，以及 Preview 不引入固定高度纵向滚动。

## 4. 风险与剩余验收

1. 窄屏三列可能在极窄窗口、长 database/schema/table 标识符或较长英文辅助文字下变得拥挤。代码的值允许断行，但视觉密度需在 `390×844` 和 DBX WebView 实测。
2. Generate 全宽提升主操作可发现性，但英文同 seed/新 seed 文案可能折为两行；需要键盘/触屏与焦点验收。
3. CSS source-level 回归测试不等于浏览器排版测试；不能据此宣称首屏出现几行 Preview 数据或视觉回归已通过。
4. DBX 当前包在 Windows/macOS 的真实加载、授权采样状态、错误状态及 Host 原生保存仍需实际验收。Preview/Export 不变不代表本轮替代了 P5 真机验收。

## 5. 验证记录

- `npm test`：**280/280 passed**（38 suites；包括新增窄屏布局回归测试与既有 UI/规则/约束/采样/导出/包契约覆盖）。
- `npm run lint`：通过，83 files。
- `npm run typecheck`：通过，production UI/Host/Core/package 边界验证通过。
- `npm run build`：通过，生成 unsigned universal `.dbxp` review candidate；构建目录在忽略的 `dist/`，未提交。
- `git diff --check`：通过。
- 没有运行 DBX Desktop 实机测试或浏览器 viewport 截图；对应事项保持 **PENDING**。
