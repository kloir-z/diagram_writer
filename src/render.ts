// .drawio を PNG に書き出す。draw.io Desktop を使わず、vendor/drawio の公式エクスポート用スクリプト
// （export3.html と同じ js/export.js の render()）をシステムの Chrome/Edge のヘッドレスで動かす。
// 外部通信はしない：vendor/ と fonts/ はリクエスト横取りで返し、Google Fonts の BIZ UD 要求は同梱 TTF に差し替える。
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer-core';

const root = resolve(import.meta.dirname, '..');
const drawioDir = resolve(root, 'vendor/drawio');
const fontsDir = resolve(root, 'fonts');
const ORIGIN = 'https://drawio.invalid/';

const FONT_FILES: Record<string, Record<number, string>> = {
  'BIZ UDPGothic': { 400: 'BIZUDPGothic-Regular.ttf', 700: 'BIZUDPGothic-Bold.ttf' },
  'BIZ UDGothic': { 400: 'BIZUDGothic-Regular.ttf', 700: 'BIZUDGothic-Bold.ttf' },
};

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function fontFaceCss(families: string[]): string {
  return families
    .flatMap((family) =>
      Object.entries(FONT_FILES[family]).map(
        ([weight, file]) =>
          `@font-face{font-family:'${family}';src:url(${ORIGIN}fonts/${file}) format('truetype');font-weight:${weight};}`,
      ),
    )
    .join('\n');
}

// export3.html と同じ読み込み順。Electron 版と同様に stencils/shapes を先に読み、eval を止める。
const RENDER_HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<script src="js/export-init.js"></script>
<link rel="stylesheet" href="mxgraph/css/common.css">
<style>${fontFaceCss(Object.keys(FONT_FILES))}</style>
<script src="js/app.min.js"></script>
<script src="js/stencils.min.js"></script>
<script src="js/shapes-14-6-5.min.js"></script>
<script src="js/export.js"></script>
<script>mxStencilRegistry.allowEval = false;</script>
</head>
<body style="margin:0;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact"></body>
</html>`;

async function serveLocal(req: HTTPRequest, path: string): Promise<void> {
  if (path === 'render.html') {
    return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: RENDER_HTML });
  }
  const base = path.startsWith('fonts/') ? fontsDir : drawioDir;
  const file = resolve(base, path.startsWith('fonts/') ? path.slice('fonts/'.length) : path);
  if (!file.startsWith(base + sep)) return req.respond({ status: 403, body: '' });
  try {
    const body = await readFile(file);
    return req.respond({
      status: 200,
      contentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    });
  } catch {
    return req.respond({ status: 404, body: '' });
  }
}

// fontSource の Google Fonts CSS（css / css2?family=BIZ+UDPGothic:wght@...）を同梱フォントの CSS で返す。
function googleFontsFamilies(url: URL): string[] {
  return url.searchParams
    .getAll('family')
    .flatMap((value) => value.split('|'))
    .map((value) => value.split(':')[0].trim());
}

async function handleRequest(req: HTTPRequest, blocked: Set<string>): Promise<void> {
  const raw = req.url();
  if (raw.startsWith(ORIGIN)) return serveLocal(req, new URL(raw).pathname.slice(1));
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return req.continue();

  const url = new URL(raw);
  if (url.hostname === 'fonts.googleapis.com') {
    const families = googleFontsFamilies(url);
    if (families.length > 0 && families.every((family) => family in FONT_FILES)) {
      return req.respond({
        status: 200,
        contentType: 'text/css',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: fontFaceCss(families),
      });
    }
  }
  blocked.add(raw);
  return req.abort('blockedbyclient');
}

interface PageResult {
  png: Uint8Array;
  pageCount: number;
  blocked: string[];
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// export.js が #LoadingComplete の bounds 属性に書く JSON。
function parseBounds(raw: string | null): Bounds | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null) return null;
  if (!('x' in value && 'y' in value && 'width' in value && 'height' in value)) return null;
  const { x, y, width, height } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
  return { x, y, width, height };
}

async function renderPage(browser: Browser, xml: string, pageIndex: number, scale: number, border: number): Promise<PageResult> {
  const page = await browser.newPage();
  const errors: string[] = [];
  const blocked = new Set<string>();
  try {
    page.on('pageerror', (err) => errors.push(err instanceof Error ? err.message : String(err)));
    await page.setRequestInterception(true);
    page.on('request', (req) => void handleRequest(req, blocked));
    await page.goto(`${ORIGIN}render.html`, { waitUntil: 'load' });

    const data = { xml, format: 'png', scale: String(scale), border: String(border), from: String(pageIndex) };
    await page.evaluate((d) => {
      if (!('render' in window) || typeof window.render !== 'function') throw new Error('export.js の render() がない');
      window.render(d);
    }, data);
    const done = await page.waitForSelector('#LoadingComplete', { timeout: 60_000 });
    if (done === null) throw new Error('描画完了マーカーが見つからない');
    if (errors.length > 0) throw new Error(`描画中のエラー:\n${errors.join('\n')}`);

    const info = await done.evaluate((el) => ({
      bounds: el.getAttribute('bounds'),
      pageCount: el.getAttribute('pageCount'),
    }));
    const bounds = parseBounds(info.bounds);
    if (bounds === null || bounds.width < 5 || bounds.height < 5) throw new Error('図が空か、読み込めない');

    const failedFonts = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`),
    );
    if (failedFonts.length > 0) throw new Error(`フォント読み込み失敗: ${failedFonts.join(', ')}`);

    // draw.io Desktop と同じく、原点から bounds の右下までを切り出す（+1 はスクロールバー対策の名残）。
    const width = Math.ceil(bounds.x + bounds.width) + 1;
    const height = Math.ceil(bounds.y + bounds.height) + 1;
    await page.setViewport({ width, height });
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    return { png, pageCount: Number(info.pageCount ?? '1'), blocked: [...blocked] };
  } finally {
    await page.close();
  }
}

async function findChrome(): Promise<string> {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : CHROME_CANDIDATES;
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // 次の候補
    }
  }
  throw new Error(`Chrome/Edge が見つからない（CHROME_PATH で指定可）: ${candidates.join(', ')}`);
}

function outputBase(input: string, outDir: string): string {
  const rel = relative(root, input);
  const name = rel.startsWith('..') || isAbsolute(rel) ? input.split(sep).pop()! : rel;
  return resolve(outDir, name.replace(/\.drawio$/, ''));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scale: { type: 'string', default: '2' },
    border: { type: 'string', default: '10' },
    'out-dir': { type: 'string', default: 'out' },
  },
});

if (positionals.length === 0) {
  console.error('使い方: node src/render.ts [--scale 2] [--border 10] [--out-dir out] <file.drawio>...');
  process.exit(2);
}

try {
  await access(resolve(drawioDir, 'js/app.min.js'));
} catch {
  console.error('vendor/drawio がない。先に npm run fetch-vendor を実行する。');
  process.exit(1);
}

const scale = Number(values.scale);
const border = Number(values.border);
const outDir = resolve(root, values['out-dir']);
const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: true });
let failed = false;

try {
  for (const arg of positionals) {
    const input = resolve(arg);
    try {
      const xml = await readFile(input, 'utf8');
      const base = outputBase(input, outDir);
      const first = await renderPage(browser, xml, 0, scale, border);
      const pages = [first];
      for (let i = 1; i < first.pageCount; i++) pages.push(await renderPage(browser, xml, i, scale, border));

      for (const [i, result] of pages.entries()) {
        const out = first.pageCount === 1 ? `${base}.png` : `${base}.p${i + 1}.png`;
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, result.png);
        console.log(out.startsWith(root + sep) ? relative(root, out) : out);
        for (const url of result.blocked) console.warn(`  警告: 外部リソースをブロックした: ${url}`);
      }
    } catch (err) {
      failed = true;
      console.error(`${arg}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
} finally {
  await browser.close();
}

if (failed) process.exit(1);
