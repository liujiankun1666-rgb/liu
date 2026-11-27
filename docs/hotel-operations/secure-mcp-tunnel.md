# ChatGPT 与 ClawX 的正式私有连接准备

核查日期：2026-11-27。当前仅完成本机子链与接入准备，未取得真实隧道/账户关联的成功证据。运行客户端、健康检查通过和 ChatGPT 实际调用是不同检查点。

## 复用入口与边界

直接复用仓库 [stdio 桥接](../../scripts/hotel-mcp-bridge.mjs)，无需新增公网 Host API、Gateway 代理或第二套任务系统。它将 MCP JSON-RPC 转到本机 `127.0.0.1:<已核端口>/hotel-bridge/mcp`，使用门店范围限定的桥接凭据。默认端口不等于现场端口，必须显式核实。

接入拓扑：ChatGPT → 官方 Secure MCP Tunnel → 本机 tunnel-client → 本仓库 stdio 脚本 → ClawX 任务管理。官方隧道通过出站连接访问私有服务，不要求公开本机端口。[官方概览](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

现有桥接支持初始化、发现、按范围建草稿、状态查询和获准的入队/派发；不提供老板审批、结果接受、岗位配置或经营写入权限。长任务派发先返回当前状态，再用 `hotel_status` 查询同一任务；不要等模型执行结束才返回一个隧道请求，也不要在超时后换幂等键重建。stdio 当前每条消息最多 1 MiB、单次本机 HTTP 等待 30 秒，容量不足应另行评估，不能假定等于隧道服务上限。

## 账户条件由实际界面核实

- 正确 Platform 组织、目标 ChatGPT 工作区及二者的隧道关联。
- 服务实际返回的完整 tunnel_id，不能编造或截短。
- 隧道创建/编辑权限为 Read + Manage；运行凭据和应用操作者为 Read + Use。ChatGPT 自定义 MCP 权限另外核实。
- 仅用于隧道运行的受限 API 凭据；它不同于本机酒店桥接令牌、Host API/Gateway 令牌及 Codex OAuth。禁止拿任意现有认证文件替代。

先复用已有合格资源。缺上述条件时，停止在“准备完成/未连接”，不启动内置 stub 冒充酒店服务器。[官方权限与接入流程](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)

## 条件具备后的本机操作

1. macOS 按官方 Homebrew tap 安装 `openai/tools/tunnel-client`；安装前检查已有版本/配置。直接 ZIP 若被 Gatekeeper 阻止，不移除隔离属性或关闭检查。[官方安装说明](https://github.com/openai/tunnel-client#install-with-homebrew)
2. 先运行 `tunnel-client --version` 和 `tunnel-client help quickstart`。以现场帮助为准；本文件没有声称已运行当前二进制。
3. 用官方 `init` 的 `sample_mcp_stdio_local` 创建独立 profile；指定真实 tunnel_id，MCP command 指向已核的绝对 Node 可执行文件和本仓库 `scripts/hotel-mcp-bridge.mjs`。不在命令中内嵌令牌，不使用 `--embedded-mcp-stub`。
4. 本机私密输入桥接令牌到 `CLAWX_HOTEL_BRIDGE_TOKEN`，显式设置 `CLAWX_PORT_CLAWX_HOST_API`。隧道运行 key 优先在 profile 用 `file:` 或 `env:` 引用；实际秘密不写公开 YAML、命令参数、工单、截图或日志。私有文件 0600、目录 0700；不要把整个用户环境作为配置材料复制。
5. 对独立 profile 执行 `doctor --explain`，再前台 `run`。检查健康、ready、实际轮询及同一 stdio 子进程的 MCP discovery；不要只看进程存在。健康管理监听保持回环。后续确需长期运行时选一种官方托管方式，不并行启多个同隧道实例，不新增酒店排期。[配置参考](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md)
6. 由有权限的操作者在 ChatGPT 添加 Tunnel 类型的自定义 MCP，选择同一隧道并核所需应用认证；仅本机通道就绪不能代替此步骤。

当前授权没有要求修改全局 Codex 配置或安装 tunnel-client 的 Codex 插件。隧道服务安装与模型提供商的地区支持是不同问题，不通过改变出口或复制 OAuth 解决。

## 必须留下的验收记录

| 检查点 | 成功标准 |
|---|---|
| 账户/关联 | 实际组织、工作区、隧道与最小权限吻合；公开证据只写脱敏结论 |
| 本机上游 | initialize/tools/list 成功，仅出现本仓库范围内工具；未暴露管理凭据 |
| 隧道 | doctor、ready、轮询与发现有实际证据；无秘密日志 |
| 云端开始 | 真正 ChatGPT 工具调用创建或引用已授权的无经营写入任务，本机读到同一对象 |
| 执行回传 | 当前 task/attempt 对应真实执行器和结构化来源；结果先 needs_review |
| 独立验收 | 服务端 reviewer 的真实结果或老板明确决定可追溯；桥接不能自行 accept |
| 云端重读 | ChatGPT 再次调用查到相同结果及实际验收状态；不是人工粘贴 |
| 边界/恢复 | 无效凭据、跨店、重复请求和断连按既有规则处理；先查询再决定是否重试 |

未完成最后几项时，不宣称三层系统整体接通。当前现场已验证的范围见 [TASK-011 脱敏验证摘要](task-011-verification.md)。
