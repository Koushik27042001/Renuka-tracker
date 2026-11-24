import { beforeEach, expect, it, vi } from 'vitest';
import {
  deleteOfflineDraft,
  offlineDrafts,
  readOfflineImage,
  saveOfflineCapture,
  withOfflineCapture,
} from '../src/offlineStore';

const fixtures = vi.hoisted(() => ({
  files: new Map<string, string>(),
  credentials: new Map<string, string>(),
  rows: new Map<string, string>(),
  directories: new Set<string>(),
}));
vi.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: async ({ service }: { service: string }) => {
    const password = fixtures.credentials.get(service);
    return password ? { password } : false;
  },
  setGenericPassword: async (
    _account: string,
    password: string,
    { service }: { service: string },
  ) => {
    fixtures.credentials.set(service, password);
    return true;
  },
}));
vi.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    async execute(sql: string, args: string[] = []) {
      const [owner, id, payload] = args;
      const key = owner + ':' + id;
      if (sql.startsWith('INSERT OR REPLACE INTO drafts')) fixtures.rows.set(key, payload);
      if (sql.startsWith('DELETE FROM drafts')) fixtures.rows.delete(key);
      return {
        rows: sql.startsWith('SELECT id,payload')
          ? Array.from(fixtures.rows)
              .filter(([value]) => value.startsWith(owner + ':'))
              .map(([value, stored]) => ({ id: value.slice(owner.length + 1), payload: stored }))
          : [],
      };
    },
  }),
}));
vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      dirs: { DocumentDir: '/data', CacheDir: '/cache' },
      stat: async (path: string) => ({ size: fixtures.files.get(path)?.length }),
      hash: async () => 'fixture-checksum',
      exists: async (path: string) => fixtures.files.has(path) || fixtures.directories.has(path),
      mkdir: async (path: string) => fixtures.directories.add(path),
      readFile: async (path: string) => {
        if (!fixtures.files.has(path)) throw new Error('missing file');
        return fixtures.files.get(path);
      },
      writeFile: async (path: string, value: string) => fixtures.files.set(path, value),
      unlink: async (path: string) => fixtures.files.delete(path),
    },
  },
}));
beforeEach(() => {
  fixtures.files.clear();
  fixtures.credentials.clear();
  fixtures.rows.clear();
  fixtures.directories.clear();
});
it('encrypts metadata and the private file and keeps both scoped to the employee', async () => {
  const image = 'c2VsZmll';
  const draft = {
    id: 'draft-id',
    attendanceId: 'attendance',
    capturedAt: '2026-11-24T10:00:00Z',
    input: { visitDate: '2026-11-24', clientName: 'Private customer', purpose: 'Inspection' },
    imageType: 'image/jpeg',
    metadata: { location: { latitude: 20, longitude: 90 } },
  };
  fixtures.files.set('/cache/capture', image);
  await saveOfflineCapture('employee-one', draft, 'file:///cache/capture');
  const cipher = fixtures.files.get('/data/renuka-evidence/employee-one-draft-id.encrypted');
  expect(cipher).toBeDefined();
  expect(cipher).not.toContain(image);
  expect(fixtures.rows.get('employee-one:draft-id')).not.toContain('Private customer');
  const [saved] = await offlineDrafts('employee-one');
  expect(saved).toMatchObject(draft);
  expect(await offlineDrafts('employee-two')).toEqual([]);
  await expect(readOfflineImage('employee-two', saved)).rejects.toThrow();
  await deleteOfflineDraft('employee-two', draft.id);
  expect(await readOfflineImage('employee-one', saved)).toBe(image);
  await expect(
    withOfflineCapture('employee-one', saved, async (uri) => {
      expect(fixtures.files.get(uri.slice(7))).toBe(image);
      throw new Error('upload interruption');
    }),
  ).rejects.toThrow('upload interruption');
  expect(fixtures.files.has('/cache/renuka-sync-draft-id')).toBe(false);
  expect(await readOfflineImage('employee-one', saved)).toBe(image);
  await deleteOfflineDraft('employee-one', draft.id);
  expect(await offlineDrafts('employee-one')).toEqual([]);
  expect(fixtures.files.has('/data/renuka-evidence/employee-one-draft-id.encrypted')).toBe(false);
});
