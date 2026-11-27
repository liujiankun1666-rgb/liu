// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hotel-handoff-'));
  roots.push(root);
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const source = join(root, 'source.json'); writeFileSync(source, '{"test":true}\n');
  const input = {
    hotel_id: 'test-hotel', channel: '携程', source_path: source,
    source_sha256: hash(readFileSync(source)),
    scope: { date_basis: 'period', funnel_device_filter: 'APP', entry_filter: '来自列表页', units: 'UV' },
    previous: { query_start: '2026-11-13', query_end: '2026-11-19', observed_at: '2026-11-27T08:00:00+08:00', form_uv: 10, submit_users: 7 },
    current: { query_start: '2026-11-20', query_end: '2026-11-26', observed_at: '2026-11-27T08:00:00+08:00', form_uv: 12, submit_users: 4 },
  };
  const inputPath = join(root, 'input.json');
  function run(basename?: string, digest?: string) {
    writeFileSync(inputPath, JSON.stringify(input));
    return spawnSync(process.execPath, [resolve('scripts/hotel-local-report-handoff.mjs'),
      `--input=${inputPath}`, `--input-sha256=${digest ?? hash(readFileSync(inputPath))}`,
      `--workspace=${workspace}`, '--source-thread=test-codex-thread', '--agent-id=test-openclaw-agent',
      '--property-id=test-property', '--hotel-id=test-hotel', ...(basename ? [`--basename=${basename}`] : []),
    ], { encoding: 'utf8' });
  }
  return { root, workspace, source, input, run };
}

describe('local report handoff boundaries', () => {
  it('writes identical sources idempotently, but preserves old evidence when later data differs', () => {
    const f = fixture();
    expect(f.run().status).toBe(0);
    const old = readFileSync(join(f.workspace, 'ctrip-funnel.json'));
    expect(f.run().status).toBe(0);
    f.input.current.submit_users = 5;
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(join(f.workspace, 'ctrip-funnel.json')).equals(old)).toBe(true);
    expect(f.run('ctrip-funnel-20261128-task010').status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(f.workspace, 'ctrip-funnel-20261128-task010.manifest.json'), 'utf8'));
    expect(manifest.sourceCodexThreadId).toBe('test-codex-thread');
    expect(manifest.openclawAgentId).toBe('test-openclaw-agent');
    expect(manifest.bidirectionalChatControl).toBe(false);
  });

  it.each(['ctrip-funnel.json', 'handoff-manifest.json'])('rejects a pre-existing symlink at %s without modifying its target', (name) => {
    const f = fixture(); const outside = join(f.root, 'sentinel');
    writeFileSync(outside, 'unchanged'); symlinkSync(outside, join(f.workspace, name));
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('unchanged');
  });

  it('rejects unreviewed input, changed sources, path traversal and missing measurements', () => {
    const f = fixture();
    expect(f.run(undefined, '0'.repeat(64)).status).not.toBe(0);
    expect(f.run('../outside').status).not.toBe(0);
    f.input.current.form_uv = Number.NaN;
    expect(f.run().status).not.toBe(0);
    f.input.current.form_uv = 12;
    writeFileSync(f.source, '{"changed":true}');
    expect(f.run().status).not.toBe(0);
  });
});
