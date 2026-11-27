import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HotelSnapshot } from '../../../shared/hotel';
import { HotelService } from './domain';

export interface HotelSnapshotStore {
  load(): Promise<HotelSnapshot | null>;
  save(snapshot: HotelSnapshot): Promise<void>;
}

/** A single main-process service serializes writes; rename commits a complete snapshot. */
export class FileHotelStore implements HotelSnapshotStore {
  constructor(readonly path: string) {}

  async load(): Promise<HotelSnapshot | null> {
    try {
      const text = await readFile(this.path, 'utf8');
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || !('schemaVersion' in value)
        || value.schemaVersion !== 1) throw new Error('Unsupported hotel data schema; restore or migrate before continuing');
      const snapshot = value as HotelSnapshot;
      for (const key of ['properties', 'bindings', 'tasks', 'knowledge', 'schedules', 'audit'] as const) {
        if (!Array.isArray(snapshot[key])) throw new Error(`Invalid hotel data: ${key}`);
      }
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('Invalid hotel data revision');
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // Never silently reset malformed or unreadable operational data.
      throw error;
    }
  }

  async save(snapshot: HotelSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(snapshot, null, 2), 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, this.path);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
}

export class MemoryHotelStore implements HotelSnapshotStore {
  constructor(private value: HotelSnapshot | null = null) {}
  async load(): Promise<HotelSnapshot | null> { return this.value ? structuredClone(this.value) : null; }
  async save(snapshot: HotelSnapshot): Promise<void> { this.value = structuredClone(snapshot); }
}

let service: Promise<HotelService> | undefined;
export function getHotelService(): Promise<HotelService> {
  service ??= (async () => {
    const { app } = await import('electron');
    return new HotelService(new FileHotelStore(join(app.getPath('userData'), 'hotel-command-center.json')));
  })();
  return service;
}
