import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getOpenClawConfigDir, getOpenClawDir } from '../../utils/paths';

export type HotelExecutionAction = 'read' | 'analysis' | 'code';
export interface HotelExecutionPolicy {
  allowed: boolean;
  reason: string;
  /** A verified upper bound, not a claim that every tool/provider is available. */
  verifiedTools: string[];
}

const VERIFIED_RUNTIME_VERSION = '2026.4.1';
const READ_TOOLS = new Set([
  'read', 'web_search', 'web_fetch', 'sessions_list', 'sessions_history',
  'agents_list', 'memory_search', 'memory_get',
]);
const CODE_TOOLS = new Set([...READ_TOOLS, 'write', 'edit', 'apply_patch', 'exec', 'process']);
// OpenClaw ignores an allowlist containing only unavailable/plugin tools. These
// built-ins are created unconditionally for the embedded chat execution path.
const CORE_ANCHORS = new Set(['read', 'sessions_list', 'sessions_history', 'agents_list']);
const LOCAL_WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'exec']);
type ObjectRecord = Record<string, unknown>;

function record(value: unknown): ObjectRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectRecord : {};
}

function blocked(reason: string): HotelExecutionPolicy {
  return { allowed: false, reason, verifiedTools: [] };
}

function hasIncludes(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasIncludes);
  const object = record(value);
  return Object.hasOwn(object, '$include') || Object.values(object).some((item) => (
    item !== null && typeof item === 'object' && hasIncludes(item)
  ));
}

function toolList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) return null;
  return value.map((entry: string) => entry.trim().toLowerCase());
}

function primaryModel(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  const primary = record(value).primary;
  return typeof primary === 'string' ? primary.trim() : undefined;
}

function modelRuntimeIssue(config: ObjectRecord, agent: ObjectRecord, defaults: ObjectRecord): string | null {
  // ACP/CLI harnesses have their own permission systems; embedded tool policy
  // cannot prove those harnesses safe. A fresh hotel session must use embedded.
  if (agent.runtime !== undefined) return '该 Agent 配置了独立 runtime；ACP 等执行器的权限尚未核验，请使用受限嵌入式 Agent 或交接技术工单。';
  const primary = primaryModel(agent.model) || primaryModel(defaults.model);
  if (!primary) return '尚未找到显式模型配置，无法确认嵌入式执行路径。';
  const fallbacks = record(agent.model).fallbacks ?? record(defaults.model).fallbacks ?? [];
  if (!Array.isArray(fallbacks) || fallbacks.some((value) => typeof value !== 'string')) {
    return '模型回退配置无法核验。';
  }
  const backends = Object.keys(record(defaults.cliBackends)).map((key) => key.trim().toLowerCase());
  for (const model of [primary, ...fallbacks as string[]]) {
    const normalized = model.trim().toLowerCase();
    if (!normalized.includes('/') || normalized.includes('${')) return '模型或回退模型使用了未解析引用，请先明确 provider/model。';
    const provider = normalized.split('/')[0];
    if (provider.endsWith('-cli') || backends.includes(provider)) {
      return '模型或回退模型使用 CLI 后端，其工具权限不受本检查器控制。';
    }
    const providerConfig = record(record(record(config.models).providers)[provider]);
    if (providerConfig.runtime !== undefined) return '模型供应商配置了额外 runtime，执行权限尚未核验。';
  }
  return null;
}

function sandboxIssue(agent: ObjectRecord, defaults: ObjectRecord, agentTools: ObjectRecord, globalTools: ObjectRecord): string | null {
  const local = record(agent.sandbox);
  const global = record(defaults.sandbox);
  const effective = (key: string) => local[key] ?? global[key];
  if (effective('mode') !== 'all') return '代码任务要求 sandbox.mode="all"，目前不能证明所有任务都在沙箱内执行。';
  if ((effective('backend') ?? 'docker') !== 'docker') return '该沙箱后端尚未核验；当前仅接受受限 Docker 执行配置。';
  const scope = effective('scope') ?? (effective('perSession') === false ? 'shared' : 'agent');
  if (scope !== 'session' && scope !== 'agent') return '代码任务要求独立 session 或 agent 沙箱，不能使用 shared 沙箱。';
  const localDocker = record(local.docker);
  const globalDocker = record(global.docker);
  const dockerValue = (key: string) => localDocker[key] ?? globalDocker[key];
  if ((dockerValue('network') ?? 'none') !== 'none') return '代码沙箱网络尚未隔离；请先使用 network="none" 的受限执行环境。';
  if ((dockerValue('readOnlyRoot') ?? true) !== true) return '代码沙箱需要只读根文件系统。';
  const capDrop = dockerValue('capDrop') ?? ['ALL'];
  if (!Array.isArray(capDrop) || !capDrop.includes('ALL')) return '代码沙箱需要 capDrop 包含 ALL。';
  for (const docker of [globalDocker, localDocker]) {
    if (docker.binds !== undefined && (!Array.isArray(docker.binds) || docker.binds.length > 0)) {
      return '代码沙箱包含额外宿主机挂载，需单独验证后才能自动执行。';
    }
    if (['dangerouslyAllowReservedContainerTargets', 'dangerouslyAllowExternalBindSources', 'dangerouslyAllowContainerNamespaceJoin']
      .some((key) => docker[key] === true)) return '代码沙箱启用了绕过隔离的选项。';
  }
  if (dockerValue('seccompProfile') === 'unconfined' || dockerValue('apparmorProfile') === 'unconfined') {
    return '代码沙箱关闭了系统隔离策略，需先核验执行环境。';
  }
  const execHost = record(agentTools.exec).host ?? record(globalTools.exec).host;
  // In the pinned runtime, an explicit sandbox host rejects a requested host
  // override; auto would allow a model to request gateway/node execution.
  if (execHost !== 'sandbox') return '代码任务要求 tools.exec.host="sandbox"，auto/gateway/node 不能作为隔离证明。';
  if (record(agentTools.elevated).enabled !== false && record(globalTools.elevated).enabled !== false) {
    return '代码任务必须显式关闭 elevated，防止命令绕过沙箱在宿主机执行。';
  }
  return null;
}

/**
 * Fail-closed preflight for the repository's pinned embedded runtime.
 * Agent allow + alsoAllow is a non-widenable cap: global/provider/profile and
 * sandbox policies are subsequent/intersecting filters, not permission grants.
 * This does not attest third-party plugin code, live Docker health, or account
 * permissions. It never rewrites the user's configuration.
 */
export function evaluateHotelExecutionPolicy(
  configValue: unknown,
  agentId: string,
  action: HotelExecutionAction,
  runtimeVersion = VERIFIED_RUNTIME_VERSION,
): HotelExecutionPolicy {
  if (runtimeVersion !== VERIFIED_RUNTIME_VERSION) return blocked('OpenClaw 版本与已核验版本不一致，需重新验证工具策略后派单。');
  if (!['read', 'analysis', 'code'].includes(action)) return blocked('此执行策略不接受外部业务写入动作。');
  const config = record(configValue);
  if (hasIncludes(config)) return blocked('配置包含 $include；未解析完整配置前不能核验工具权限。');
  const normalizedId = agentId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedId)) return blocked('Agent ID 无效，不能核验执行权限。');
  const agents = record(config.agents);
  const entries = Array.isArray(agents.list) ? agents.list.map(record) : [];
  const matches = entries.filter((entry) => typeof entry.id === 'string' && entry.id.trim().toLowerCase() === normalizedId);
  if (matches.length !== 1) return blocked('未找到唯一的显式 Agent 配置；岗位绑定和启用状态不能代替权限核验。');
  const agent = matches[0];
  const defaults = record(agents.defaults);
  const runtimeIssue = modelRuntimeIssue(config, agent, defaults);
  if (runtimeIssue) return blocked(runtimeIssue);
  const globalTools = record(config.tools);
  const agentTools = record(agent.tools);
  const allow = toolList(agentTools.allow);
  const alsoAllow = agentTools.alsoAllow === undefined ? [] : toolList(agentTools.alsoAllow);
  if (!allow?.length || alsoAllow === null) {
    return blocked('需要该 Agent 的显式非空 tools.allow 工具清单；角色提示词、profile 和 deny 不能单独证明只读权限。');
  }
  const ceiling = [...new Set([...allow, ...alsoAllow])];
  const allowedSet = action === 'code' ? CODE_TOOLS : READ_TOOLS;
  const unsafe = ceiling.filter((tool) => !allowedSet.has(tool));
  if (unsafe.length) {
    return blocked(`该 Agent 工具上限包含未核验工具：${unsafe.join(', ')}。请先准备受限执行权限，或输入导出报表进行分析。`);
  }
  if (!ceiling.some((tool) => CORE_ANCHORS.has(tool))) {
    return blocked('工具清单缺少稳定核心工具；OpenClaw 可能忽略仅含插件或不可用工具的 allowlist。');
  }
  const workspaceOnly = record(agentTools.fs).workspaceOnly ?? record(globalTools.fs).workspaceOnly;
  if ((ceiling.includes('read') || action === 'code') && workspaceOnly !== true) {
    return blocked('文件工具需要 tools.fs.workspaceOnly=true，避免访问岗位工作区外的文件。');
  }
  if (action === 'code') {
    if (!ceiling.some((tool) => LOCAL_WRITE_TOOLS.has(tool))) return blocked('代码任务尚未配置受限的代码修改或执行工具。');
    const issue = sandboxIssue(agent, defaults, agentTools, globalTools);
    if (issue) return blocked(issue);
  }
  return {
    allowed: true,
    reason: action === 'code'
      ? '已核验工具上限及受限 Docker 配置；实际沙箱可用性、代码结果仍需执行和验收。'
      : '已核验 Agent 的受限工具上限；工具实际可用性仍受全局、供应商、profile 和沙箱策略限制。',
    verifiedTools: ceiling,
  };
}

export async function inspectHotelExecutionPolicy(agentId: string, action: HotelExecutionAction): Promise<HotelExecutionPolicy> {
  try {
    const configDir = getOpenClawConfigDir();
    const configFile = join(configDir, 'openclaw.json');
    if ((process.env.OPENCLAW_CONFIG_PATH && resolve(process.env.OPENCLAW_CONFIG_PATH) !== resolve(configFile))
      || (process.env.OPENCLAW_STATE_DIR && resolve(process.env.OPENCLAW_STATE_DIR) !== resolve(configDir))) {
      return blocked('运行时使用自定义配置路径，尚未核验其与本地权限快照一致。');
    }
    const [configText, packageText] = await Promise.all([
      readFile(configFile, 'utf8'),
      readFile(join(getOpenClawDir(), 'package.json'), 'utf8'),
    ]);
    const version = record(JSON.parse(packageText)).version;
    if (typeof version !== 'string') return blocked('无法确认 OpenClaw 运行时版本。');
    return evaluateHotelExecutionPolicy(JSON.parse(configText), agentId, action, version);
  } catch {
    // Do not expose config contents, credential-bearing error text, or paths.
    return blocked('无法读取完整的本地 JSON 配置或运行时版本；执行权限尚未核验。');
  }
}
