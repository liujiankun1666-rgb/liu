import { assertIsolatedOpenClawConfig, openClawIsolation } from './openclaw-isolation';
import { isAbsolute } from 'node:path';

/** Real local integration mode: no mock transport and no permission-policy bypass. */
export function isLocalOnboarding(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAWX_LOCAL_ONBOARDING === '1';
}

export function localOnboardingUserData(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!isLocalOnboarding(env)) return undefined;
  if (env.CLAWX_E2E === '1') throw new Error('Local onboarding cannot run in E2E mode');
  const directory = env.CLAWX_USER_DATA_DIR?.trim();
  if (!directory || !isAbsolute(directory)) {
    throw new Error('Local onboarding requires an explicit absolute CLAWX_USER_DATA_DIR');
  }
  assertIsolatedOpenClawConfig(env);
  return openClawIsolation(env)?.userData ?? directory;
}

export function assertUpdatesAllowed(): void {
  if (isLocalOnboarding()) throw new Error('Updates are disabled during local onboarding; preserve the reviewed source build');
}

/** Never inspect/terminate an unowned listener or run the legacy orphan cleanup. */
export async function findOnboardingGateway(
  port: number,
  ownsProcess: boolean,
  ownedPid: number | undefined,
  waitForFree: (port: number, timeoutMs: number) => Promise<void>,
): Promise<{ port: number } | null> {
  if (ownsProcess && ownedPid !== undefined) return { port };
  await waitForFree(port, 1000);
  return null;
}
