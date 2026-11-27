// @vitest-environment node
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertUpdatesAllowed, findOnboardingGateway, localOnboardingUserData } from '@electron/utils/local-onboarding';

afterEach(() => vi.unstubAllEnvs());

describe('real local onboarding boundaries', () => {
  it('requires a separate absolute user-data path and rejects E2E mixing', () => {
    expect(() => localOnboardingUserData({ CLAWX_LOCAL_ONBOARDING: '1' })).toThrow('absolute');
    expect(() => localOnboardingUserData({ CLAWX_LOCAL_ONBOARDING: '1', CLAWX_USER_DATA_DIR: 'relative' })).toThrow('absolute');
    expect(() => localOnboardingUserData({ CLAWX_LOCAL_ONBOARDING: '1', CLAWX_USER_DATA_DIR: '/private/test', CLAWX_E2E: '1' })).toThrow('E2E');
    expect(localOnboardingUserData({ CLAWX_LOCAL_ONBOARDING: '1', CLAWX_USER_DATA_DIR: '/private/test' })).toBe('/private/test');
    expect(localOnboardingUserData({ CLAWX_USER_DATA_DIR: '/private/test' })).toBeUndefined();
  });

  it('fails on a foreign listener without closing or connecting to it', async () => {
    const foreign = createServer();
    await new Promise<void>((resolve, reject) => {
      foreign.once('error', reject);
      foreign.listen(0, '127.0.0.1', resolve);
    });
    const address = foreign.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    let connected = false;
    foreign.on('connection', () => { connected = true; });
    try {
      await expect(findOnboardingGateway(address.port, false, undefined, async (port) => {
        await new Promise<void>((resolve, reject) => {
          const probe = createServer();
          probe.once('error', reject);
          probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
        });
      })).rejects.toThrow();
      expect(foreign.listening).toBe(true);
      expect(connected).toBe(false);
    } finally { await new Promise<void>((resolve) => foreign.close(() => resolve())); }
  });

  it('does not adopt a pid unless this manager actually owns it', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await findOnboardingGateway(18789, false, 123, wait)).toBeNull();
    expect(wait).toHaveBeenCalledWith(18789, 1000);
    wait.mockClear();
    expect(await findOnboardingGateway(18789, true, 123, wait)).toEqual({ port: 18789 });
    expect(wait).not.toHaveBeenCalled();
  });

  it('blocks upstream update actions independently of saved settings', () => {
    vi.stubEnv('CLAWX_LOCAL_ONBOARDING', '1');
    expect(() => assertUpdatesAllowed()).toThrow('Updates are disabled');
    vi.stubEnv('CLAWX_LOCAL_ONBOARDING', '0');
    expect(() => assertUpdatesAllowed()).not.toThrow();
  });
});
