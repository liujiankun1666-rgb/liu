# 验证记录

验证日期：2026-11-27。开发基线为 `a82c10de860d5476a1d5b9ee2278758ab22ed994`，使用仓库锁定的 pnpm 10.31.0 与依赖锁文件。

## 已完成的开发验证

| 检查 | 命令或范围 | 结果 |
| --- | --- | --- |
| TypeScript 项目检查 | `corepack pnpm exec tsc --noEmit --pretty false` | 通过 |
| 全量自动化测试 | `corepack pnpm test` | 75 个测试文件、518 项测试全部通过 |
| 构建 | `corepack pnpm run build:vite` | Renderer、Electron Main 和 Preload 构建通过 |
| ESLint | `corepack pnpm exec eslint .` | 0 错误；原有 `src/pages/Channels/index.tsx:137` 有 1 项未使用的禁用指令警告 |
| 通信回放与基线比较 | `corepack pnpm run comms:replay` 和 `corepack pnpm run comms:compare` | 通过 |
| 本机 MCP 适配器语法 | `node --check scripts/hotel-mcp-bridge.mjs` | 通过 |
| 补丁格式 | `git diff --check` | 通过 |

518 项测试包括新增酒店领域、Gateway 运行时、权限预检、内容上下文、MCP 桥接、HTTP 路由与 React 页面/辅助函数测试，并不是 518 项真实酒店后台验收。

其中 `tests/unit/hotel-http.test.ts` 的 11 项测试启动临时回环 HTTP 服务，通过真实 `fetch` 调用实际路由、领域服务与桥接处理器。它们验证任务入队、审批版本失效、生产写入阻塞、令牌与来源校验、门店范围、请求大小和 JSON 格式；仅替换 Electron 路径依赖及实际 Gateway 执行端。这些属于接口集成测试，不是桌面端到端测试。

## 已知基线问题

额外执行 `tsc -p tsconfig.node.json --noEmit --composite false` 时，完整 Main 进程类型检查有 25 项诊断。在同一依赖环境中对比未修改的基线提交，基线也有相同的 25 项诊断，本次没有新增诊断。构建成功不等于该额外检查已经清零；本分支没有把无关的既有类型问题混入酒店功能变更。

测试运行有 EventEmitter 监听数量提示，构建有已有模块混合静态/动态导入的打包提示，均未导致检查失败。

## 桌面验证与现场接入边界

已新增 `tests/e2e/hotel-operations.spec.ts`，覆盖工作台任务、知识、八岗位和审批版本行为。本地云端 Linux 环境没有可用图形显示环境：Electron headless 启动在窗口创建前崩溃，可用浏览器二进制与下载也受环境限制，因此本地没有通过 Electron E2E。

公开分支建立后，GitHub Actions 已实际启动 Linux、macOS、Windows 三个平台的 Electron 测试。第一轮每个平台均为 12 项通过、1 项失败，定位到酒店任务表单的下拉框标签包含选项文字。修复将标签与控件显式关联，提示文字改用可访问描述，并补充 3 项回归测试；原有 E2E 断言保持不变。工作流会保存截图与 trace 工件，最新提交的最终结果应以 [PR 检查](https://github.com/liujiankun1666-rgb/liu/pull/1/checks)为准。

以下内容还必须在实际运营电脑上验证：

- 使用已有 Agent ID、当前 Gateway 和模型完成一次真实派单、回传、独立验收及异常恢复。
- 核对别样红、携程、抖音登录状态与来源数据，确认兴城市竞对名单及指标口径。
- 检查当前执行端实际生效的工具与隔离配置；静态预检不是对运行中进程权限的证明。
- 验证本机 MCP 客户端连接；云端 ChatGPT 还需要独立的安全远程接入层。
- 如后续需要调价、发布、付款、退款或发消息，必须另行接入具体生产适配器并验证审批与执行回执。目前审批通过也不会执行这些动作。

功能范围及现场检查步骤分别见[功能矩阵](README.md)与[接入文档](integration.md)。
