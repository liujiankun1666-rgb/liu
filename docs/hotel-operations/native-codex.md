# 独立原生 Codex 技术执行端

此适配器是独立于 OpenClaw/Gateway 的技术执行路径，只接受 `role=codex`、`action=code`。它不把 `openai-codex` 模型配置、既有 Codex 酒店聊天或同名 OpenClaw Agent 当成技术端。原 `execution-policy.ts` 的嵌入式权限检查保持原样。

## 配置与身份

管理应用的独立 userData 中可放置 `hotel-codex-executor.json`（本机私有，不提交）：

```json
{
  "version": 1,
  "enabled": true,
  "executable": "/absolute/path/to/codex",
  "seedWorkspace": "/absolute/reviewed-source-snapshot",
  "runRoot": "/absolute/private-execution-records",
  "propertyIds": ["approved-property-id"],
  "model": "existing-available-model"
}
```

路径必须已存在、绝对且经 realpath 校验；seed 和 runRoot 不得重叠/嵌套。seed 只接受普通文件和目录，拒绝符号链接、设备/FIFO/socket，以及 `.git`、`.codex`、`.agents`、`.aws` 配置目录。每次执行复制独立源快照；不直接修改原项目，不自动合并、部署或更新原账号配置。

保留身份 `codex-cli-technical` 仅用于本适配器。若 OpenClaw 列表已经出现同名ID，预检拒绝，不能偷换实际运行时。岗位选择中只向Codex岗展示原生技术端。正式权限入口为：

`GET /api/hotel/execution-policy?agentId=codex-cli-technical&action=code&propertyId=<id>`

该入口需要管理认证，返回明确backend及实际预检；不能把普通桥接令牌当管理令牌。原Gateway执行器仍走原检查。

## 执行限制

目前固定核验 `codex-cli 0.171.0-alpha.13.2`，其他版本默认阻塞。每次派单前使用同一命名权限profile做真实系统探针：工作区读写允许，父目录及符号链接逃逸读写拒绝，模型工具对实际回环服务器的网络请求被拒绝。profile只给最小系统运行路径和本次工作区权限；根目录不广泛可读，不继承旧danger-full-access。

真实 `codex exec` 使用同一profile、`--strict-config`、`--ignore-user-config`、`--ephemeral`、JSON事件和结构化输出schema。明确禁用用户MCP、apps、plugins、hooks、notify、web和子Agent；不加载shell环境全量变量。审批为never，不能请求提升权限或改权限profile。既有用户设置保持原样。所选模型显式传入；本轮沿用既有 `gpt-6-astra` 与ultra，不能假定任何账号都可用。

模型服务通信由正式Codex自己处理，与受限命令网络分开。适配器不读取/复制凭据，不启动OpenClaw，因此不会触发其内置Codex CLI认证同步。原生Codex使用自身正式登录；如果认证或服务连接失败，保留真实错误和状态，不通过复制认证、改变出口或降低隔离解决。

`:minimal` 不保证所有开发运行时可用：现场系统Python shim和Node26在此范围下不可用，系统shell可用。工具依赖不足时应明确报告；不得自动安装或扩大路径权限。当前策略偏向小型本地修复，扩大开发环境要重新核验。

## 任务、回传与中断

管理层先持久化attempt，再执行CLI。每attempt独占目录保存模型不可写的invocation、PID/进程组、退出证据、JSON事件和receipt；工作区为其子目录。相同任务/幂等键不能重复建单，running任务不能重复派发。适配器有同步占位，避免异步配置读取时两个任务同时穿过空闲检查。

总时限600秒，超时先TERM，限时再KILL，仅处理自有进程组；退出未确认保留不确定状态。不会盲目重试。客户端断连不终止已经接收的任务。应用重启后，未确认执行先恢复blocked，reconcile只读取原task/attempt、当前配置指纹及工作区匹配的receipt，不重发模型调用。

只有进程正常结束、真实工具事件、turn.completed和匹配当前task/attempt的结构化结果齐全才接收。`resultOrigin=codex-cli` 与原Gateway/桥接/手工录入分开；native attempt拒绝其他来源的结果覆盖。结果先进入needs_review，执行器和共享桥接都不能自行accept。没有服务端独立reviewer时应保留待验收，技术总管的外部检查文件不能冒充老板或服务端supervisor决定。

## 证据分层

- 单元/E2E使用合成测试夹具，仅验证代码/界面，不能证明真实模型已执行。
- 本机MCP兼容客户端→管理层→原生技术端的实跑，只证明本机子链。
- 当前云端ChatGPT需要真实认证连接及重新查询才能算整体贯通。官方Secure MCP Tunnel可作为单独接入选项，不要求向公网暴露Host API；账号/组织/工作区权限须实际核验。
- OAuth回调页仅显示“收到授权回调”，最终token exchange可能失败；不能在收到code时宣称认证成功。
