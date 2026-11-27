import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  token: vi.fn(), sanitize: vi.fn(), browser: vi.fn(), session: vi.fn(), proxy: vi.fn(),
  cleanup: vi.fn(), list: vi.fn(), read: vi.fn(), plugin: vi.fn(),
}));
vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('@electron/utils/secure-storage', () => ({ getApiKey: vi.fn(), getDefaultProvider: vi.fn(), getProvider: vi.fn() }));
vi.mock('@electron/utils/openclaw-auth', () => ({ syncGatewayTokenToConfig: calls.token, sanitizeOpenClawConfig: calls.sanitize, syncBrowserConfigToOpenClaw: calls.browser, syncSessionIdleMinutesToOpenClaw: calls.session }));
vi.mock('@electron/utils/openclaw-proxy', () => ({ syncProxyConfigToOpenClaw: calls.proxy }));
vi.mock('@electron/utils/channel-config', () => ({ cleanupDanglingWeChatPluginState: calls.cleanup, listConfiguredChannels: calls.list, readOpenClawConfig: calls.read }));
vi.mock('@electron/utils/plugin-install', () => ({ copyPluginFromNodeModules: calls.plugin, fixupPluginManifest: vi.fn(), cpSyncSafe: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

describe('onboarding manual Gateway start', () => {
  it('synchronizes only the explicit local token and never repairs existing config/plugins', async () => {
    vi.stubEnv('CLAWX_LOCAL_ONBOARDING', '1');
    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');
    await syncGatewayConfigBeforeLaunch({ gatewayToken: 'test-token-not-a-credential' } as Parameters<typeof syncGatewayConfigBeforeLaunch>[0]);
    expect(calls.token).toHaveBeenCalledExactlyOnceWith('test-token-not-a-credential');
    for (const key of ['sanitize', 'browser', 'session', 'proxy', 'cleanup', 'list', 'read', 'plugin'] as const) {
      expect(calls[key]).not.toHaveBeenCalled();
    }
  });
});
