import { describe, expect, it } from 'vitest';
import { evaluateHotelExecutionPolicy } from '@electron/services/hotel/execution-policy';

function analysisConfig() {
  return {
    agents: {
      defaults: { model: { primary: 'openai/example-model', fallbacks: [] as string[] } },
      list: [{ id: 'hotel', tools: { allow: ['read', 'web_search'], fs: { workspaceOnly: true } } }],
    },
    tools: { profile: 'full' },
  };
}

function codeConfig() {
  const config = analysisConfig();
  return {
    ...config,
    agents: {
      ...config.agents,
      list: [{
        id: 'hotel',
        tools: {
          allow: ['read', 'write', 'edit', 'exec', 'process'],
          fs: { workspaceOnly: true }, exec: { host: 'sandbox' }, elevated: { enabled: false },
        },
        sandbox: { mode: 'all', scope: 'session', docker: { network: 'none', readOnlyRoot: true, capDrop: ['ALL'] } },
      }],
    },
  };
}

describe('hotel execution policy', () => {
  it('accepts a literal read-only agent cap despite a broad global profile', () => {
    expect(evaluateHotelExecutionPolicy(analysisConfig(), 'hotel', 'analysis')).toMatchObject({
      allowed: true, verifiedTools: ['read', 'web_search'],
    });
  });

  it.each(['browser', 'exec', 'process', 'write', 'edit', 'message', 'sessions_spawn', 'sessions_send', 'session_status', '*', 'group:fs', 'vendor_lookup'])(
    'blocks an unverified or effectful tool: %s', (tool) => {
      const config = analysisConfig();
      config.agents.list[0].tools.allow.push(tool);
      expect(evaluateHotelExecutionPolicy(config, 'hotel', 'analysis').allowed).toBe(false);
    },
  );

  it('does not treat deny or role enablement as an allow boundary', () => {
    const config = analysisConfig();
    config.agents.list[0].tools.allow = [];
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'read').allowed).toBe(false);
    expect(evaluateHotelExecutionPolicy({ tools: { deny: ['exec', 'write'] } }, 'main', 'read').allowed).toBe(false);
  });

  it('accounts for alsoAllow widening the agent policy', () => {
    const config = analysisConfig();
    Object.assign(config.agents.list[0].tools, { alsoAllow: ['exec'] });
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'analysis').allowed).toBe(false);
  });

  it('requires a stable core entry to avoid ignored plugin-only allowlists', () => {
    const config = analysisConfig();
    config.agents.list[0].tools.allow = ['web_search', 'memory_search'];
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'read').reason).toContain('稳定核心工具');
  });

  it('honors the effective agent/global workspace restriction', () => {
    const config = analysisConfig();
    config.agents.list[0].tools.fs.workspaceOnly = false;
    Object.assign(config.tools, { fs: { workspaceOnly: true } });
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'analysis').allowed).toBe(false);
  });

  it('does not let provider overrides broaden a verified agent ceiling', () => {
    const config = analysisConfig();
    Object.assign(config.agents.list[0].tools, { byProvider: { openai: { allow: ['*'], alsoAllow: ['exec'] } } });
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'analysis').verifiedTools).toEqual(['read', 'web_search']);
  });

  it('rejects a fallback that would use a CLI execution path', () => {
    const config = analysisConfig();
    config.agents.defaults.model.fallbacks = ['codex-cli/model'];
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'analysis').reason).toContain('CLI');
  });

  it('rejects ACP and custom CLI runtimes', () => {
    const acp = analysisConfig();
    Object.assign(acp.agents.list[0], { runtime: { type: 'acp' } });
    expect(evaluateHotelExecutionPolicy(acp, 'hotel', 'analysis').allowed).toBe(false);
    const cli = analysisConfig();
    Object.assign(cli.agents.defaults, { cliBackends: { openai: { command: 'custom-runner' } } });
    expect(evaluateHotelExecutionPolicy(cli, 'hotel', 'analysis').allowed).toBe(false);
  });

  it('fails closed on unresolved includes, duplicate ids and unknown versions', () => {
    expect(evaluateHotelExecutionPolicy({ ...analysisConfig(), $include: './policy.json' }, 'hotel', 'read').allowed).toBe(false);
    const config = analysisConfig();
    config.agents.list.push({ ...config.agents.list[0] });
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'read').allowed).toBe(false);
    expect(evaluateHotelExecutionPolicy(analysisConfig(), 'hotel', 'read', 'next-version').allowed).toBe(false);
  });

  it('requires sandbox isolation before a code task can run', () => {
    expect(evaluateHotelExecutionPolicy(codeConfig(), 'hotel', 'code').allowed).toBe(true);
    const config = codeConfig();
    config.agents.list[0].sandbox.mode = 'off';
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'code').allowed).toBe(false);
  });

  it('blocks auto exec host, elevated escape, shared sandbox and external network', () => {
    const host = codeConfig();
    host.agents.list[0].tools.exec.host = 'auto';
    expect(evaluateHotelExecutionPolicy(host, 'hotel', 'code').allowed).toBe(false);
    const elevated = codeConfig();
    elevated.agents.list[0].tools.elevated.enabled = true;
    expect(evaluateHotelExecutionPolicy(elevated, 'hotel', 'code').allowed).toBe(false);
    const shared = codeConfig();
    shared.agents.list[0].sandbox.scope = 'shared';
    expect(evaluateHotelExecutionPolicy(shared, 'hotel', 'code').allowed).toBe(false);
    const network = codeConfig();
    network.agents.list[0].sandbox.docker.network = 'host';
    expect(evaluateHotelExecutionPolicy(network, 'hotel', 'code').allowed).toBe(false);
  });

  it('checks global mounts even when agent Docker config is restrictive', () => {
    const config = codeConfig();
    Object.assign(config.agents.defaults, { sandbox: { docker: { binds: ['/host:/host'] } } });
    expect(evaluateHotelExecutionPolicy(config, 'hotel', 'code').reason).toContain('额外宿主机挂载');
  });
});
