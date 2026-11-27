# TASK-011：可公开的技术验证摘要

核查日期：2026-11-27。基线 `4734afef404b4d01f751f6132692f70b9a25f25a`。本摘要仅含技术事实，不附运营电脑路径、账号/门店资料、任务/会话私有标识、凭据或认证原始日志。

**本机管理层到独立 Codex 技术执行端的真实子链通过；整个三层系统未完成。** 真实结果仍为 `needs_review`。外部技术审查不是老板批准，也不替代管理层服务端独立 reviewer。

## 三条连接

| 连接 | 已验证范围 | 尚缺 |
|---|---|---|
| ChatGPT ↔ ClawX | 本机 MCP 兼容客户端初始化、发现、建单/查询、幂等、鉴权、跨范围拒绝 | 云端 ChatGPT 实际认证连接、真实发起及再次工具查询；不能用本机命令冒称已连接 |
| ClawX ↔ 业务执行器 | 既有配置、权限/审批实现保留 | 正式可用模型认证、业务执行器成功回执与实际权限验证；本轮 Gateway 停止，没有经营写入 |
| ClawX ↔ Codex 技术端 | 真实原生 CLI 工具执行、结构化回传、完整正常退出重启后重新查询一致 | 服务端独立 reviewer；通用 Node/Python 开发工具链和长期稳定性未验证 |

现场另核到提供商 OAuth 换令牌的 `403 / unsupported_country_region_territory`。另一条 Gateway 模型网络错误没有更细根因，不合并归因。OAuth 回调页只确认收到回调，不再提前宣称认证成功。未改变出口、复制认证或关闭策略来消除此错误。

## 真实技术任务和权限

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

技术方法入口：[原生技术执行端](native-codex.md)。正式云端连接准备：[Secure MCP Tunnel](secure-mcp-tunnel.md)，复用现有stdio桥接；当前无账户侧成功证据，不能称已接通。下一步仍是正式连接及服务端独立验收，保持needs_review，不扩大业务写入。
