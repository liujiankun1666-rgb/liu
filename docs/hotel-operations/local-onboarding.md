# 本机受控联调入口

正常应用入口仍为构建后的 Electron；`CLAWX_LOCAL_ONBOARDING=1` 是独立正常运行模式，不是 `CLAWX_E2E`。必须同时给出绝对路径 `CLAWX_USER_DATA_DIR`，缺失/相对路径或同时开启 E2E 会立即失败。

```sh
pnpm run build:vite
CLAWX_LOCAL_ONBOARDING=1 CLAWX_USER_DATA_DIR=/absolute/private/clawx-user-data pnpm exec electron .
```

此模式跳过自动安装 CLI、修改 shell profile、部署技能/插件、遥测、自动启动 Gateway、登录启动项注册、自动修复及应用更新。既有 settings 不会被默认值覆盖；仅本次联调的新设置默认关闭自动行为。Gateway 手动启动只同步本次令牌，遇外来进程占端口即失败，不接管或终止它。退出只停止自己创建的 Gateway。

### 独立 Gateway 测试副本

仅隔离 userData 不足以隔离默认的 OpenClaw 文件和18789端口。需要并行保留原实例时，可在本模式上显式启用 `CLAWX_ISOLATED_OPENCLAW=1`，并同时指定以下环境变量；只传给本次 Main/子进程，不改全局环境或 HOME/CODEX_HOME。

```sh
CLAWX_LOCAL_ONBOARDING=1
CLAWX_ISOLATED_OPENCLAW=1
CLAWX_USER_DATA_DIR=/absolute/private-copy/userData
OPENCLAW_STATE_DIR=/absolute/private-copy/openclaw-state
OPENCLAW_CONFIG_PATH=/absolute/private-copy/openclaw-state/openclaw.json
CLAWX_ISOLATED_WORKSPACE_DIR=/absolute/private-copy/workspaces
CLAWX_ISOLATION_PROTECTED_DIRS='["/absolute/original/userData","/absolute/original/workspaces"]'
CLAWX_PORT_CLAWX_HOST_API=13212
CLAWX_PORT_OPENCLAW_GATEWAY=18791
```

须先准备独立配置和获授权的本机凭据；不能复制含其他产品凭据的混合auth store。config路径必须为stateDir/openclaw.json，所有Agent的workspace必须在指定workspaceRoot内、agentDir在stateDir/agents内，config的Gateway端口须与显式端口一致。目录必须绝对、彼此分离，并与默认及显式列出的原目录无重叠；符号链接按真实路径核验，悬空链接拒绝。缺参数、E2E混用、默认/重复端口或原目录重叠均在启动前失败。

Main的发现/权限检查、认证配置、技能/媒体/频道路径和Gateway子进程均使用同一新state/config；旧实例不会被接管。默认未启用该开关时，原路径和Gateway端口不变。本模式不修改共享依赖来补扩展。它仍不是操作系统凭据沙箱：下述固定运行时内部CLI同步限制继续存在，不能用它宣称零读取原认证。

**已知边界：这不是操作系统沙箱。** 固定 OpenClaw 2026.4.1 的认证存储会自动读取并同步本机 Codex CLI/钥匙串凭据，位于 `dist/store-CTbjH_aB.js` 的 `syncExternalCliCredentials`。本模式的应用启动守卫不能阻止该运行时内部行为；`OPENCLAW_AUTH_STORE_READONLY` 也不阻止读取。2026-11-27 现场确认新 Agent profile 与 Codex 源 access/refresh 相等。因此禁止声称认证完全隔离；在来源未审查或该副作用不能接受时，不派发模型任务。不要改 HOME/CODEX_HOME、复制凭据、修改出口或补丁依赖来绕过正式认证。

## Codex 岗位的本地报表交接

`scripts/hotel-local-report-handoff.mjs` 复用已有 reviewed input 结构：校验门店、携程渠道、原来源 SHA256、已审输入 SHA256、七天周期与缺失值，然后仅投影 APP/来自列表页漏斗的必要计数到受限工作区。它不查询后台、不访问认证、不发送聊天消息。

```sh
node scripts/hotel-local-report-handoff.mjs \
  --input=/absolute/reviewed-input.json \
  --input-sha256=EXPECTED_REVIEWED_SHA256 \
  --workspace=/absolute/existing-agent-workspace \
  --source-thread=SOURCE_CODEX_THREAD_ID \
  --agent-id=ACTUAL_OPENCLAW_AGENT_ID \
  --property-id=CLAWX_PROPERTY_ID \
  --hotel-id=SOURCE_HOTEL_ID \
  --basename=ctrip-funnel-20261127-task009
```

每个任务/日期用新 basename 或独立工作目录。相同内容可以重复运行；异内容、符号链接或越界 basename 拒绝，不能删掉旧任务来源来覆盖。写入采用独占创建、不跟随链接、文件模式0600。途中错误可能留下未完成文件，必须保留核查并换新任务目录，不能把失败输出当成功。manifest 将 sourceCodexThreadId 和 openclawAgentId 分开；这是本地数据交接，不是原聊天双向控制，不迁移排期。

真实派单只提供文件名与问题，让受限 Agent 用真实 read 工具读取。回传需带来源并停在 needs_review，由总管独立验收；配置预检、固定包工具工厂测试、模型调用及成功结果重启是不同层级。

## 2026-11-27 现场验证范围

独立源码正常启动和实际 Gateway 已验证；仅 read 工具、目录越界/绝对路径/符号链接拒绝通过固定2026.4.1工具工厂实测。原生新 OAuth token exchange 返回403 unsupported_country_region_territory；实际派单的回执另为 network connection error，不能认定两者已证同一原因。没有成功的结构化模型结果，也未验收业务建议。

退出/重启可以核失败任务、attempt、会话、错误和审计历史持久化；这不替代成功模型结果恢复或 Gateway 重连验证。测试模式 E2E 不代表真实后台/模型接通。全量单元测试需记录实际 Node 版本；系统 Node26 上观察到现有 jsdom 测试的 localStorage 未定义，不能把构建或局部测试通过写成全量通过。
