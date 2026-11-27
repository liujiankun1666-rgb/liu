#!/usr/bin/env node
/** MCP stdio adapter for locally installed Codex / other MCP clients. Never prints credentials. */
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function bridgeEndpoint(environment = process.env) {
  const port = environment.CLAWX_PORT_CLAWX_HOST_API || '13210';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid CLAWX_PORT_CLAWX_HOST_API');
  return `http://127.0.0.1:${port}/hotel-bridge/mcp`;
}

export async function runBridge(environment = process.env) {
  const token = environment.CLAWX_HOTEL_BRIDGE_TOKEN;
  if (!token) throw new Error('Set CLAWX_HOTEL_BRIDGE_TOKEN from ClawX → 酒店总管 → 接入. Do not use the Gateway or Host API token.');
  const endpoint = bridgeEndpoint(environment);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) throw new Error('MCP message exceeds 1 MB');
      request = JSON.parse(line);
      const response = await fetch(endpoint, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify(request), signal: AbortSignal.timeout(30000),
      });
      if (response.status === 202) continue;
      if (!response.ok) throw new Error(`Local hotel bridge returned HTTP ${response.status}. Check ClawX, the scoped credential, and port configuration.`);
      const result = await response.json();
      if (request.id !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      if (request?.id !== undefined || !request) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32000, message: error instanceof Error ? error.message : 'Local hotel bridge unavailable' } })}\n`);
      } else process.stderr.write('Hotel bridge could not deliver a notification.\n');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBridge().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
