#!/usr/bin/env node
// Local, minimum-field handoff. Never reads Codex credentials or sends chat messages.
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const separator = entry.indexOf('=');
  if (!entry.startsWith('--') || separator < 3) throw new Error('Use explicit --key=value arguments');
  return [entry.slice(2, separator), entry.slice(separator + 1)];
}));
for (const key of ['input', 'input-sha256', 'workspace', 'source-thread', 'agent-id', 'property-id', 'hotel-id']) {
  if (!args[key]) throw new Error(`Missing --${key}`);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputBytes = await readFile(resolve(args.input));
if (hash(inputBytes) !== args['input-sha256']) throw new Error('Input SHA256 changed; obtain a fresh reviewed source');
const input = JSON.parse(inputBytes);
if (input.hotel_id !== args['hotel-id'] || input.channel !== '携程') throw new Error('Hotel/channel mismatch');
if (hash(await readFile(input.source_path)) !== input.source_sha256) throw new Error('Original source SHA256 changed');
const project = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.query_start) || !/^\d{4}-\d{2}-\d{2}$/.test(value.query_end)) throw new Error('Missing source period');
  const start = Date.parse(`${value.query_start}T00:00:00+08:00`);
  const end = Date.parse(`${value.query_end}T00:00:00+08:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 6 * 86400000) throw new Error('Expected an inclusive seven-day source period');
  for (const key of ['form_uv', 'submit_users']) if (!Number.isInteger(value[key]) || value[key] < 0) throw new Error(`Missing/invalid ${key}; do not substitute zero`);
  if (value.submit_users > value.form_uv) throw new Error('Submitted users exceed form UV; review source definition');
  if (!Number.isFinite(Date.parse(value.observed_at))) throw new Error('Missing observation time');
  return { query_start: value.query_start, query_end: value.query_end, observed_at: value.observed_at, form_uv: value.form_uv, submit_users: value.submit_users };
};
if (input.scope?.funnel_device_filter !== 'APP' || input.scope?.entry_filter !== '来自列表页') throw new Error('Unreviewed funnel/device scope');
const report = {
  schemaVersion: 1, hotel_id: input.hotel_id, channel: input.channel,
  scope: { date_basis: input.scope.date_basis, device_filter: input.scope.funnel_device_filter, entry_filter: input.scope.entry_filter, units: input.scope.units },
  previous: project(input.previous), current: project(input.current),
  cause_of_change: null, paid_orders: null, fulfilled_stays: null,
  provenance: { source_sha256: input.source_sha256, reviewed_input_sha256: hash(inputBytes), sourceCodexThreadId: args['source-thread'], transfer: 'local sanitized report; not a live backend query or bidirectional chat bridge' },
};
const workspace = await realpath(resolve(args.workspace));
if (!(await stat(workspace)).isDirectory()) throw new Error('Workspace must already exist');
const basename = args.basename || 'ctrip-funnel';
if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(basename)) throw new Error('Use a restricted versioned --basename, e.g. ctrip-funnel-20261127-task009');
// Use a fresh basename or task/date workspace for new data. Never delete an earlier task source.
async function writeExclusiveOrIdentical(path, bytes) {
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await existing.stat()).isFile() || hash(await existing.readFile()) !== hash(bytes)) throw new Error('Existing handoff differs; choose a new task/date basename');
    } finally { await existing.close(); }
    return;
  }
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
const destination = join(workspace, `${basename}.json`);
await writeExclusiveOrIdentical(destination, bytes);
const manifest = {
  schemaVersion: 1, sourceCodexThreadId: args['source-thread'], openclawAgentId: args['agent-id'],
  sourceHotelId: input.hotel_id, clawxPropertyId: args['property-id'],
  originalSourceSha256: input.source_sha256, reviewedInputSha256: hash(inputBytes),
  destination: `${basename}.json`, destinationSha256: hash(bytes),
  periods: [report.previous.query_start, report.previous.query_end, report.current.query_start, report.current.query_end],
  handoffMode: 'local-report', bidirectionalChatControl: false, migratedSchedules: false,
};
await writeExclusiveOrIdentical(join(workspace, basename === 'ctrip-funnel' ? 'handoff-manifest.json' : `${basename}.manifest.json`), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
console.log(JSON.stringify(manifest, null, 2));
