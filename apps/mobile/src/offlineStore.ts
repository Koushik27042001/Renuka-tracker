import { open } from '@op-engineering/op-sqlite';
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js';
import * as Keychain from 'react-native-keychain';
import blob from 'react-native-blob-util';
import type { CurrentAttendance, VisitInput } from '@renuka/shared';

export type OfflineDraft = {
  id: string;
  input: VisitInput;
  attendanceId: string;
  capturedAt: string;
  metadata: object;
  imageType: string;
  checksum: string;
  serverId?: string;
  uploaded?: boolean;
  uploadedAt?: number;
  manuallyRetryable?: boolean;
  attempts?: number;
  retryAt?: number;
  problem?: string;
};
const filesystem = blob.fs;
function random(length: number) {
  const source = globalThis as typeof globalThis & {
    crypto: { getRandomValues: (bytes: Uint8Array) => Uint8Array };
  };
  return source.crypto.getRandomValues(new Uint8Array(length));
}
let connection: ReturnType<typeof open> | undefined;
async function database() {
  connection ??= open({ name: 'renuka-offline.sqlite' });
  await connection.execute(
    'CREATE TABLE IF NOT EXISTS drafts (owner TEXT, id TEXT, payload TEXT NOT NULL, PRIMARY KEY(owner,id))',
  );
  await connection.execute(
    'CREATE TABLE IF NOT EXISTS shifts (owner TEXT PRIMARY KEY, payload TEXT NOT NULL)',
  );
  return connection;
}
const directory = () => filesystem.dirs.DocumentDir + '/renuka-evidence';
const imagePath = (owner: string, id: string) =>
  directory() + '/' + owner + '-' + id + '.encrypted';
const keyRequests = new Map<string, Promise<Uint8Array>>();
function keyFor(owner: string) {
  const existing = keyRequests.get(owner);
  if (existing) return existing;
  const request = (async () => {
    const service = 'com.renukatracker.offline.' + owner;
    const saved = await Keychain.getGenericPassword({ service });
    if (saved) return hexToBytes(saved.password);
    const key = random(32);
    if (
      !(await Keychain.setGenericPassword(owner, bytesToHex(key), {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }))
    )
      throw new Error('Could not save an encryption key.');
    return key;
  })();
  keyRequests.set(owner, request);
  void request.finally(() => keyRequests.delete(owner)).catch(() => undefined);
  return request;
}
function binding(owner: string, name: string) {
  return Uint8Array.from(owner + ':' + name, (character) => character.charCodeAt(0));
}
async function seal(owner: string, name: string, value: string) {
  const nonce = random(12);
  const bytes = Uint8Array.from(encodeURIComponent(value), (character) => character.charCodeAt(0));
  return (
    bytesToHex(nonce) +
    bytesToHex(gcm(await keyFor(owner), nonce, binding(owner, name)).encrypt(bytes))
  );
}
async function unseal(owner: string, name: string, value: string) {
  const plain = gcm(
    await keyFor(owner),
    hexToBytes(value.slice(0, 24)),
    binding(owner, name),
  ).decrypt(hexToBytes(value.slice(24)));
  let result = '';
  for (let offset = 0; offset < plain.length; offset += 8192)
    result += String.fromCharCode(...plain.subarray(offset, offset + 8192));
  return decodeURIComponent(result);
}
export async function cacheOfflineShift(owner: string, shift: CurrentAttendance) {
  const db = await database();
  await db.execute('INSERT OR REPLACE INTO shifts VALUES (?, ?)', [
    owner,
    await seal(owner, 'shift', JSON.stringify(shift)),
  ]);
}
export async function readOfflineShift(owner: string): Promise<CurrentAttendance | undefined> {
  const db = await database();
  const [row] = (await db.execute('SELECT payload FROM shifts WHERE owner=?', [owner])).rows;
  return row ? JSON.parse(await unseal(owner, 'shift', String(row.payload))) : undefined;
}
export async function offlineDrafts(owner: string): Promise<OfflineDraft[]> {
  const db = await database();
  const rows = (
    await db.execute('SELECT id,payload FROM drafts WHERE owner=? ORDER BY rowid DESC', [owner])
  ).rows;
  return Promise.all(
    rows.map(async (row) =>
      JSON.parse(await unseal(owner, 'draft:' + row.id, String(row.payload))),
    ),
  );
}
export async function saveOfflineDraft(owner: string, draft: OfflineDraft) {
  const db = await database();
  await db.execute('INSERT OR REPLACE INTO drafts VALUES (?, ?, ?)', [
    owner,
    draft.id,
    await seal(owner, 'draft:' + draft.id, JSON.stringify(draft)),
  ]);
}
export async function saveOfflineCapture(
  owner: string,
  draft: Omit<OfflineDraft, 'checksum'>,
  uri: string,
) {
  const source = uri.replace(/^file:\/\//, '');
  if (Number((await filesystem.stat(source)).size) > 8 * 1024 * 1024)
    throw new Error('This selfie is too large. Capture it again.');
  const target = imagePath(owner, draft.id);
  if (!(await filesystem.exists(directory()))) await filesystem.mkdir(directory());
  const checksum = await filesystem.hash(source, 'sha256');
  try {
    await filesystem.writeFile(
      target,
      await seal(owner, 'image:' + draft.id, await filesystem.readFile(source, 'base64')),
      'utf8',
    );
    await saveOfflineDraft(owner, { ...draft, checksum });
  } catch (error) {
    await filesystem.unlink(target).catch(() => undefined);
    throw error;
  }
}
export async function readOfflineImage(owner: string, draft: OfflineDraft) {
  const encoded = await filesystem.readFile(imagePath(owner, draft.id), 'utf8');
  return unseal(owner, 'image:' + draft.id, encoded);
}
export async function withOfflineCapture<T>(
  owner: string,
  draft: OfflineDraft,
  use: (uri: string) => Promise<T>,
) {
  const path = filesystem.dirs.CacheDir + '/renuka-sync-' + draft.id;
  try {
    await filesystem.writeFile(path, await readOfflineImage(owner, draft), 'base64');
    return await use('file://' + path);
  } finally {
    await filesystem.unlink(path).catch(() => undefined);
  }
}
export async function deleteOfflineDraft(owner: string, id: string) {
  const db = await database();
  const path = imagePath(owner, id);
  if (await filesystem.exists(path)) await filesystem.unlink(path);
  await db.execute('DELETE FROM drafts WHERE owner=? AND id=?', [owner, id]);
}
export async function clearInterruptedUploads() {
  const files = await filesystem.ls(filesystem.dirs.CacheDir);
  await Promise.all(
    files
      .filter((name) => /^renuka-sync-[a-f0-9-]{36}$/i.test(name))
      .map((name) => filesystem.unlink(filesystem.dirs.CacheDir + '/' + name)),
  );
}
