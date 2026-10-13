// vendor.lock.json に固定した draw.io の描画用ファイルと BIZ UD フォントを取得する。
// 既存ファイルの sha256 が一致すれば再取得しない。
// --update: 全ファイルを取り直して lock の sha256 を書き換える（URL のタグ/コミットを上げた後に使う）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface LockEntry {
  path: string;
  url: string;
  sha256: string;
}

function parseLock(value: unknown): { files: LockEntry[] } {
  if (typeof value !== 'object' || value === null || !('files' in value) || !Array.isArray(value.files)) {
    throw new Error('vendor.lock.json に files 配列がない');
  }
  const files = value.files.map((entry: unknown, i: number): LockEntry => {
    if (typeof entry !== 'object' || entry === null || !('path' in entry && 'url' in entry && 'sha256' in entry)) {
      throw new Error(`vendor.lock.json files[${i}] に path/url/sha256 がない`);
    }
    const { path, url, sha256 } = entry;
    if (typeof path !== 'string' || typeof url !== 'string' || typeof sha256 !== 'string') {
      throw new Error(`vendor.lock.json files[${i}] の値が文字列でない`);
    }
    return { path, url, sha256 };
  });
  return { files };
}

const root = resolve(import.meta.dirname, '..');
const lockPath = resolve(root, 'vendor.lock.json');
const lock = parseLock(JSON.parse(await readFile(lockPath, 'utf8')));
const update = process.argv.includes('--update');
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

let failed = false;

for (const entry of lock.files) {
  const dest = resolve(root, entry.path);
  if (!update) {
    const existing = await readFile(dest).catch(() => null);
    if (existing !== null && sha256(existing) === entry.sha256) continue;
  }

  const res = await fetch(entry.url);
  if (!res.ok) {
    console.error(`取得失敗: ${entry.url} (HTTP ${res.status})`);
    failed = true;
    continue;
  }
  const body = new Uint8Array(await res.arrayBuffer());
  const hash = sha256(body);
  if (update) {
    entry.sha256 = hash;
  } else if (hash !== entry.sha256) {
    console.error(`sha256 不一致: ${entry.path}\n  期待 ${entry.sha256}\n  実際 ${hash}`);
    failed = true;
    continue;
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body);
  console.log(`取得: ${entry.path} (${body.length} bytes)`);
}

if (update) await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
if (failed) process.exit(1);
