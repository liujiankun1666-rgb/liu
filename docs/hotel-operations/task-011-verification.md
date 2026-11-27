# TASK-011：可公开的技术验证摘要

核查日期：2026-11-27。最新现场复验基线 `ee3635f87ed8b668a3bb6b6c11b4caea075f0258`，下文保留此前 `4734afef404b4d01f751f6132692f70b9a25f25a` 起的各阶段记录。本摘要仅含技术事实，不附运营电脑路径、账号/门店资料、任务/会话私有标识、凭据或认证原始日志。

**本机技术执行子链，以及 DeepSeek 合成任务的执行、独立接受和有据退回已真实通过；云端 ChatGPT 完整闭环仍未验证。** 新完整合成目标经独立 reviewer 接受；旧缺项目标在独立副本中经有据退回，冻结缺项和三次失败全部保留。原 Codex 技术任务仍为 `needs_review`。这些是合成数据和本机链路验证，不代表酒店经营效果或老板业务批准。

## 三条连接

| 连接 | 已验证范围 | 尚缺 |
|---|---|---|
| ChatGPT ↔ ClawX | 本机 MCP 兼容客户端初始化、发现、建单/查询、幂等、鉴权、跨范围拒绝 | 云端 ChatGPT 实际认证连接、真实发起及再次工具查询；不能用本机命令冒称已连接 |
| ClawX ↔ 业务执行器 | DeepSeek 官方调用；受限 Gateway Agent 实际 read、结构化回传，独立 reviewer 真实 accept 与 return；工作区边界及正常重启恢复实测 | 酒店后台实际接入、经营写入和长期稳定性；合成验证不能替代酒店业务 |
| ClawX ↔ Codex 技术端 | 真实原生 CLI 工具执行、结构化回传、完整正常退出重启后重新查询一致 | 服务端独立 reviewer；通用 Node/Python 开发工具链和长期稳定性未验证 |

现场另核到提供商 OAuth 换令牌的 `403 / unsupported_country_region_territory`。另一条 Gateway 模型网络错误没有更细根因，不合并归因。OAuth 回调页只确认收到回调，不再提前宣称认证成功。未改变出口、复制认证或关闭策略来消除此错误。

## ee3635f 独立副本现场复验（当前结果）

保留原脏树、运行应用、模型、岗位和任务库，使用显式 local-onboarding 的独立 userData、OpenClaw state/config、工作区及端口；默认启动行为不变。实际 Main 与 Gateway 父子进程、监听端口、Gateway `config.get` 返回路径及新的 session 写入一致。原配置和原认证源以本机哈希保护；没有把混合 OAuth 文件拷作新身份。两个测试身份只配置 DeepSeek、空 fallback、read/workspaceOnly。固定运行时可能内部导入本机 CLI 认证的限制仍在，不能称 OS 凭据隔离；依赖通过现有 node_modules 符号链接复用，没有修改依赖包，不称其为只读挂载。

复制历史审查第三次仍错误 accept：模型把冻结缺项重新解释为局限，领域层正确拒绝。该批次确实收到新契约，不是旧构建；模型还曾用旧文件不存在推断历史读取范围，这种推断不构成证据。保留三个失败后，新增正式、本机认证的显式重开入口：同一冻结目标/批次/结果哈希/审查身份，一个替代审查仅一次执行；普通自动修复与共享桥接不能重开，旧对象不变。具体缺项和允许决定由服务端放在指令末尾，仍保留 blocked 出口，服务端不代写 assessment。

实际替代 reviewer 读取合成来源，逐项说明计数、口径、未知项与返修要求，提交 return；服务端写入 actor=supervisor，将原目标退回 draft，缺项保留，没有重新入队。另一个完整合成任务实际读入六个计数，算出两期三率为 25%/10%/2.5% 和 25%/15%/3.75%，差值为 0/+5/+1.25 个百分点；另一身份独立读取同源文件并算术核对后 accept。两条链都有真实 provider/model、read 工具事件、任务/批次/session 与冻结结果对照，未手工注入结果。

完整退出并重新打开新副本后，8项任务及全部批次/结果/审计/绑定与重启前逐值一致，正式 Host API 与磁盘一致。旧应用和 Gateway 未被停止，原技术任务仍 needs_review。新副本 Gateway 已正式恢复运行，两测试绑定禁用待命，无 queued/running；只证明正常重启后静态记录恢复，不证明断电或运行中崩溃恢复。

验证环境为 Node26.13.1、命令局部 `NODE_OPTIONS=--no-experimental-webstorage` 与获准临时回环监听：**82文件、605/605全量通过**，TypeScript、Vite构建、通信 replay/compare 通过，最终构建4个酒店 Electron E2E通过。605由ee基线566、隔离25和重开/接口14构成；旧34项默认环境失败记录保留，未改断言或通信baseline。本机实际无Host凭据和仅桥接凭据的重开请求均401。

本机 stdio MCP 初始化、工具发现、状态查询及越店拒绝已复验。官方隧道客户端准备不等于云端连接，当前 ChatGPT 尚无实际发起及重读同任务的工具证据。

## 历史阶段：真实技术任务和权限

ClawX 0.3.6 / Electron 40.8.4（Node24.14.0），正常模式、非 E2E；原生 Codex CLI `0.171.0-alpha.13.2`，单次显式使用既有模型 `gpt-6-astra` / ultra。原始模型配置和认证保持原状。独立适配器不是 OpenClaw Agent，也不是酒店 Codex 聊天。

输入为三个无业务数据的 shell 文件。实际工具先读源码、运行失败测试，只将一个脚本的减法改成加法，再跑原来三条断言通过；README 与测试文件未改。真实回传有正常退出和 `turn.completed`，管理层保存为 `resultOrigin=codex-cli`、`needs_review`。

首轮在180秒到期时没有完整最终回执，保留 uncertain；其 WebSocket 超时后正式回退 HTTPS，与地区403分开。确认进程退出后，把有界总时限修到600秒，在原任务第二 attempt 得到完整结果。没有删除首轮记录或自动连续重试。正常完整退出重启后，任务、两次attempt、结果、审计、绑定逐值保持，新 MCP 客户端读回相同快照；未声称断电或执行中崩溃恢复已经通过。

同原生权限 profile 的独立系统探针验证：本工作区读写允许，已存在父目录哨兵和符号链接越界读写拒绝，模型命令网络拒绝。实际模型 JSONL 未导出其文本声称的两项直接越界拒绝响应，因此不把模型自述算权限验收证据。模型服务必要网络和命令网络分开；最小系统 profile 下仅 shell 合成任务得到验证。

原 Gateway `execution-policy.ts` 未修改。native 身份冲突拒绝、原生回执来源限制、互斥/独占目录、有界进程组退出、配置和attempt恢复检查均有针对性测试。桥接没有老板审批或accept接口；负向经营写入仅建草稿、入队/执行被拒绝，没有真实外部动作。

## 全量失败的分类与对照

原默认 Node26.13.1 全量记录是498通过、34失败。不是34个新增产品回归：其失败用例集合与旧基线 `9561199c4c9873cdd6925517ef1cc218fe0d1592` 完全相同，五个测试文件字节一致；两基线间只有文档/约定变化。

34项都在本机 jsdom/Vitest worker 的 `localStorage` 初始化失败。Node官方记录原生 Web Storage 从v25默认启用。本地观察是：仅给顶层Node参数仍失败；将关闭原生Web Storage的选项传给workers后，同一源码与断言通过。该结论属于已复现的测试环境兼容问题，不据此保证任何 Node26 环境都相同。[Node官方选项](https://nodejs.org/api/cli.html#--no-experimental-webstorage)

| 文件 | 原失败数 | 共同错误 | 分类 |
|---|---:|---|---|
| api-client.test.ts | 18 | localStorage.removeItem 未定义 | 既有环境兼容 |
| chat-target-routing.test.ts | 2 | localStorage.clear 未定义 | 既有环境兼容 |
| host-api.test.ts | 6 | localStorage.removeItem 未定义 | 既有环境兼容 |
| host-events.test.ts | 3 | localStorage.clear 未定义 | 既有环境兼容 |
| stores.test.ts | 5 | storage.setItem 未定义 | 既有环境兼容 |

| 当前对照 | 结果 |
|---|---|
| Electron40.8.4 的 Node24.14.0，RUN_AS_NODE，以上5文件 | 37/37通过（包含原3个已通过用例）；未声称是独立安装的Node24 |
| Node26，只有顶层 `--no-experimental-webstorage` | 34失败、3通过，未修复worker环境 |
| Node26，命令局部 `NODE_OPTIONS=--no-experimental-webstorage`，以上5文件 | 37/37通过，测试和断言未改 |
| 同一兼容命令，全量，宿主禁止回环监听 | 523通过、1失败、11未执行；另外的listen EPERM环境门槛 |
| 同一兼容命令，全量，允许临时测试回环服务 | **80文件、535/535通过，0跳过** |

这是明确环境下的新验证结果，不覆盖原失败日志。535比此前532多的3项是在本次分类接续之前、原最终返修中加入的以下用例；79到80个测试文件来自第三项的新文件。本次分类接续没有删用例、改断言或刷新基线。

- `hotel-codex-cli.test.ts`：`bounds an uncooperative owned process with TERM then KILL instead of hanging`
- `hotel-runtime.test.ts`：`rejects reserved native identity collisions instead of switching an OpenClaw binding`
- `openai-callback-state.test.ts`：`OAuth callback and token exchange remain separate > shows only callback received when token exchange subsequently fails`

仓库CI固定Node24，优先沿用；当前没有重新运行完整独立Node24环境。既往Electron RUN_AS_NODE全量有一项既有Wechat `app.isPackaged` mock环境失败，它不属于这34项，本轮没有修改该测试。

一次性Node26兼容验证命令（不修改全局环境、生产运行或package脚本）：

```sh
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run
```

该命令需要宿主允许测试临时监听回环；受限运行器中的监听错误应单独标出，不能跳过测试冒称通过。

### 34项用例明细

以下每项均为旧基线已复现、当前上述Node24子集及Node26兼容全量通过；本轮新增失败0项。

| 文件 | 用例 |
|---|---|
| api-client.test.ts | api-client > backs off failed ws transport and skips it on immediate retry |
| api-client.test.ts | api-client > defaults transport preference to ipc-only |
| api-client.test.ts | api-client > enables ws->http->ipc order when ws diagnostic is on |
| api-client.test.ts | api-client > falls back to legacy channel when unified route is unsupported |
| api-client.test.ts | api-client > falls through ws/http and succeeds via ipc when advanced transports fail |
| api-client.test.ts | api-client > forwards invoke arguments and returns result |
| api-client.test.ts | api-client > normalizes raw gateway:httpProxy payload into ipc-style envelope |
| api-client.test.ts | api-client > normalizes timeout errors |
| api-client.test.ts | api-client > parses gateway:httpProxy unified envelope response |
| api-client.test.ts | api-client > rejects invalid config.patch params before gateway:httpProxy call |
| api-client.test.ts | api-client > rejects invalid config.patch.patch before gateway:httpProxy call |
| api-client.test.ts | api-client > retries once for retryable errors |
| api-client.test.ts | api-client > retries ws transport after backoff is cleared |
| api-client.test.ts | api-client > returns user-facing message for auth invalid error |
| api-client.test.ts | api-client > returns user-facing message for channel unavailable error |
| api-client.test.ts | api-client > returns user-facing message for permission error |
| api-client.test.ts | api-client > sends tuple payload for multi-arg unified requests |
| api-client.test.ts | api-client > throws meaningful error when gateway:httpProxy unified envelope fails |
| chat-target-routing.test.ts | chat target routing > switches to the selected agent main session before sending text |
| chat-target-routing.test.ts | chat target routing > uses the selected agent main session for attachment sends |
| host-api.test.ts | host-api > does not use localhost fallback when policy flag is disabled |
| host-api.test.ts | host-api > falls back to browser fetch only when IPC channel is unavailable |
| host-api.test.ts | host-api > falls back to browser fetch when hostapi handler is not registered |
| host-api.test.ts | host-api > supports legacy proxy envelope response |
| host-api.test.ts | host-api > throws message from legacy non-ok envelope |
| host-api.test.ts | host-api > uses IPC proxy and returns unified envelope json |
| host-events.test.ts | host-events > does not use SSE fallback by default for unknown events |
| host-events.test.ts | host-events > subscribes through IPC for mapped host events |
| host-events.test.ts | host-events > uses SSE fallback only when explicitly enabled |
| stores.test.ts | Settings Store > should have default values |
| stores.test.ts | Settings Store > should persist launch-at-startup setting through host api |
| stores.test.ts | Settings Store > should toggle sidebar collapsed state |
| stores.test.ts | Settings Store > should unlock dev mode |
| stores.test.ts | Settings Store > should update theme |

## 其他检查与后续

TypeScript、Vite构建、diff检查通过；针对性53项通过。4个不同Electron E2E用例分两轮通过：首次新增OAuth用例动态TypeScript import失败，改静态import后重跑该项通过；未把E2E合成夹具当真实模型证明。comms replay/compare通过，未刷新baseline。此次分类接续只改公开文档和链接，不改运行时/测试逻辑、既有应用状态或排期。

技术方法入口：[原生技术执行端](native-codex.md)。正式云端连接准备：[Secure MCP Tunnel](secure-mcp-tunnel.md)，复用现有stdio桥接；当前无账户侧成功证据，不能称已接通。该历史阶段的下一步是正式连接及服务端独立验收；当前进展以上方 ee3635f 复验为准，原技术任务仍 needs_review，不扩大业务写入。

## 后续独立代码复核与修正

在 `dbac315` 同步后，独立代码复核发现并修正两项问题：

- 原生执行器向子进程写入提示词时，子进程提前退出可能触发未处理的 stdin 管道错误。修复为监听输入流错误，沿用有界终止流程并等待真实 close 后再报告失败；不把输入未送达当成执行成功。使用真实 Node 早退子进程和超过管道缓冲的输入完成回归，原生执行器测试文件 6/6 通过。
- 本地报表交接测试的初版夹具沿用了真实经营统计，改为明确合成的历史日期和计数，并保留原断言强度；该测试文件 4/4 通过。普通后续提交只修正当前版本，`dbac315` 历史中的原夹具仍可追溯，本次未强推或改写历史，也不声称历史已清除。

本轮没有调用真实模型、读取经营后台、修改本机账号或改变 `needs_review` 状态。上文 535 项全量结果对应修正前技术提交的已记录验证，不能作为本次修正提交的新全量结果。

本轮补充的项目 TypeScript 检查、通信 replay/compare 和 diff 检查通过；原生执行器修改文件的 ESLint 通过。没有修改通信 baseline，也没有重新声明完整系统或模型认证已通过。

## 历史阶段：DeepSeek 现场接续与回传协议修复（独立验收尚未通过时）

用户在 ClawX 配置 DeepSeek 后，官方 `https://api.deepseek.com/v1/chat/completions` 实际返回 HTTP200 和预期内容。配置模型为 `deepseek-chat`，直接提供商响应 model 为 `deepseek-flash`；Gateway 的实际会话元数据记录 `deepseek-chat`。这不代表原 OpenAI OAuth 地区拒绝已消除，也不要求复制 Codex 认证进行调用。

两个专用合成测试身份固定 DeepSeek、空 fallback、仅 read、workspaceOnly。固定 OpenClaw 2026.4.1 工具工厂实测：工作区内读取成功，父目录、绝对路径和符号链接越界读取拒绝；没有新增生产工具。现有运行时的内部本地 CLI 认证导入行为仍存在，本轮未宣称凭据隔离通过。

真实试跑暴露两个协议问题：Gateway final 聚合了工具前说明和最终答案；另一次模型终态含 Markdown 说明及末尾 JSON。修复只对 Gateway 的精确任务/批次历史生效：仅取最后合格 assistant，接受裸 JSON 或末尾唯一完整 json 代码块，再执行原身份和结构校验。多代码块、块后文字、截断、错误批次、工具输出和旧结果均拒绝；历史不可读取则保留 uncertain，不能自动重发。原生 Codex 的严格解析器不变。

第一合成任务两次失败均保留。关联修复验证任务只执行一次：真实 read 返回与合成文件逐字相同，三项比率及差值独立复算一致，结果以 Gateway 来源持久化为 needs_review。来源时间引用合成快照字段；真正读取时间从运行时工具事件核验，不由模型猜时钟。服务端 ISO 毫秒归一化及未知额外字段丢弃已与原始会话对照，不声称原 JSON 逐字原样存储。

独立 reviewer 的两次真实执行都读取了自己的同源合成文件。第一次返回 accept 且自身 missingItems 非空，被拒绝；返修后自身 missingItems 为空，但目标仍有缺项且仍返回 accept，再被拒绝。未清空目标缺项、手填 assessment 或放宽领域门槛，没有把域拒绝包装成独立验收通过。当前限制是数据局限与验收缺项的语义尚需一致，以及 reviewer 对领域验收规则的遵守；需要继续适配后再验证正向验收和真实退回。两个测试绑定完成留证后待命，未改原酒店岗位或排期。

本次已整合 `a941e9a` 的原生 stdin 修复及合成测试数据，保留原本地文件副本。新增回传测试后，兼容环境全量 **80 文件、556/556** 通过：原 541 加远端早退回归 1、协议帧用例 12、历史取帧 1、核对不倒扫 1。TypeScript、构建、通信 replay/compare 通过；未刷新 baseline。此前 34 个 Node26 默认环境失败的分类与原始记录仍有效，556 只对应明确设置 `NODE_OPTIONS=--no-experimental-webstorage` 的本次环境。

ChatGPT 正式云端连接仍缺账户/隧道授权及真实发起、重读证据。本机读取不能替代该连接；模型接通、执行回传和独立验收分别记录。

最终正常完整退出并重启测试应用后，正式 Host API 与磁盘记录一致，三个合成任务的成功/失败结果、全部批次和原技术任务逐值不变；原酒店绑定未变，两个合成测试绑定已禁用待命。此证据仅证明本次正常重启后的已完成/失败记录恢复，不证明运行中断电恢复。

## 历史阶段：云端独立代码复核与验收契约（现场复验前）

复核基线为 `9d2505d667b325b990f1e798b65b298898562845`。已直接核对该提交远端测试日志：80 文件、556 项通过，代码检查/构建、通信回归及 macOS/Ubuntu/Windows Electron E2E 全部成功。以上结果对应此基线，不能自动作为后续修正提交的验证。本轮未读取运营电脑的私有原始证据或调用真实 DeepSeek。

独立复核确认，两次 reviewer 拒绝分别命中“审查自身仍有缺项”和“目标仍有缺项却给出 accept”的既有规则。修正派单说明以区分：审查完整且目标未达标时返回 completed + return；审查自身无法完成时返回 blocked。仅不妨碍当前验收标准的数据局限写入 verificationNotes；不能把真实缺项改称局限。独立 reviewer 不再收到普通总管的 plannedTasks 派单说明，避免与服务端禁止验收任务派单的规则冲突。领域层、目标结果和历史均不修改。

另在同一批次的合成历史中复现：先提取助手文本再找非空值，会越过较新的空消息、失败终态或未结束工具轮次，采纳更早结果。修正为先选最后一条助手消息，再检查终态及协议资格；最后一条不合格时，不继续向前查找旧回传。这是静态复核与回归构造确认的边界问题，未声称现场已发生。

新增 10 项回归在修复前均复现误接收，修复后运行时 46/46 通过；既有领域验收测试 35/35 通过。TypeScript、修改代码 ESLint、通信 replay/compare 及 diff 检查通过，通信 baseline 未修改。提示语澄清尚未在真实模型上复验，不能把代码测试替代真实 reviewer 的正反向验收。

现场仍需用真实 reviewer 完成一次有依据的 return，并以新的完整合成目标完成一次正向 accept；旧目标缺项与失败批次保留。ChatGPT 正式云端连接继续等待实际账号/工作区/隧道权限，以及真正的云端建单、执行、独立验收和结果重读证据。
