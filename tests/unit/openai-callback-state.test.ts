// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const observed = vi.hoisted(() => ({
  handle: undefined as undefined | ((req: { url: string }, res: { statusCode: number; setHeader: () => void; end: (text: string) => void }) => void),
  body: '', closed: false,
}));
vi.mock('node:http', () => ({ createServer: (handler: typeof observed.handle) => {
  observed.handle = handler;
  const server = { listen: (_port: number, _host: string, callback: () => void) => { callback(); return server; }, on: () => server, close: () => { observed.closed = true; } };
  return server;
} }));
vi.mock('../../electron/utils/proxy-fetch', () => ({ proxyAwareFetch: vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '{"error":{"code":"unsupported_country_region_territory"}}' }) }));
import { loginOpenAICodexOAuth } from '../../electron/utils/openai-codex-oauth';
describe('OAuth callback and token exchange remain separate', () => {
  it('shows only callback received when token exchange subsequently fails', async () => {
    await expect(loginOpenAICodexOAuth({ openUrl: async (url) => {
      const state = new URL(url).searchParams.get('state');
      observed.handle!({ url: `/auth/callback?code=synthetic-test-code&state=${state}` }, { statusCode: 0, setHeader: () => {}, end: (text) => { observed.body = text; } });
    } })).rejects.toThrow('OpenAI token exchange failed (403)');
    expect(observed.body).toContain('Authorization callback received');
    expect(observed.body).not.toContain('Authentication successful');
    expect(observed.closed).toBe(true);
  });
});
