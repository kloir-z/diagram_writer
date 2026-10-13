// 範囲記法の展開。
//   "Eth1/[1-48]" → Eth1/1 … Eth1/48
//   "esx[01-08]"  → esx01 … esx08（両端の桁数が同じならゼロ埋め）
//   "e0[a-d]"     → e0a … e0d
//   "Eth1/[1,3,5-6]" → Eth1/1, Eth1/3, Eth1/5, Eth1/6
// 角括弧が複数あれば左から順に組み合わせる（左が外側のループ）。
const MAX_EXPANSION = 10_000;

function expandItem(item: string, pattern: string): string[] {
  if (!item.includes('-')) {
    if (item === '') throw new Error(`範囲記法に空の要素がある: ${pattern}`);
    return [item];
  }
  const numeric = /^(\d+)-(\d+)$/.exec(item);
  if (numeric) {
    const [, from, to] = numeric;
    const start = Number(from);
    const end = Number(to);
    if (start > end) throw new Error(`範囲が逆順: [${item}] in ${pattern}`);
    const width = from.length === to.length ? from.length : 0;
    const out: string[] = [];
    for (let n = start; n <= end; n++) out.push(String(n).padStart(width, '0'));
    return out;
  }
  const alpha = /^([a-z])-([a-z])$/.exec(item) ?? /^([A-Z])-([A-Z])$/.exec(item);
  if (alpha) {
    const start = alpha[1].charCodeAt(0);
    const end = alpha[2].charCodeAt(0);
    if (start > end) throw new Error(`範囲が逆順: [${item}] in ${pattern}`);
    const out: string[] = [];
    for (let c = start; c <= end; c++) out.push(String.fromCharCode(c));
    return out;
  }
  throw new Error(`範囲記法を解釈できない: [${item}] in ${pattern}（数字同士 1-48 か、英字 1 文字同士 a-d）`);
}

export function expandRange(pattern: string): string[] {
  let results = [''];
  let i = 0;
  while (i < pattern.length) {
    const open = pattern.indexOf('[', i);
    const close = pattern.indexOf(']', i);
    if (close !== -1 && (open === -1 || close < open)) throw new Error(`対応する [ がない ]: ${pattern}`);
    if (open === -1) {
      const literal = pattern.slice(i);
      results = results.map((r) => r + literal);
      break;
    }
    if (close === -1) throw new Error(`] で閉じていない: ${pattern}`);
    const literal = pattern.slice(i, open);
    const body = pattern.slice(open + 1, close);
    if (body.includes('[')) throw new Error(`角括弧は入れ子にできない: ${pattern}`);
    const values = body.split(',').flatMap((item) => expandItem(item.trim(), pattern));
    const next: string[] = [];
    for (const r of results) for (const v of values) next.push(r + literal + v);
    if (next.length > MAX_EXPANSION) throw new Error(`展開結果が ${MAX_EXPANSION} 件を超える: ${pattern}`);
    results = next;
    i = close + 1;
  }
  return results;
}
