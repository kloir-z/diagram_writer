// TrueType/OpenType の文字送り幅だけを読む最小の実装（head / hhea / hmtx / cmap）。
// 描画に使う BIZ UD の TTF そのもので文字幅を測り、枠の大きさを決めるために使う。

export interface FontMetrics {
  /** 文字列の幅（px）。fontSize は px */
  width(text: string, fontSize: number): number;
}

function tableOffsets(view: DataView): Map<string, number> {
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    tables.set(tag, view.getUint32(rec + 8));
  }
  return tables;
}

/** cmap の format 12（全 Unicode）か format 4（BMP）から、コードポイント → グリフ番号の関数を作る。 */
function readCmap(view: DataView, cmapOffset: number): (codePoint: number) => number {
  const count = view.getUint16(cmapOffset + 2);
  let format4 = -1;
  for (let i = 0; i < count; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const sub = cmapOffset + view.getUint32(rec + 4);
    const format = view.getUint16(sub);
    if (format === 12 && platform === 3 && encoding === 10) {
      const groups = view.getUint32(sub + 12);
      return (cp) => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = sub + 16 + mid * 12;
          const start = view.getUint32(g);
          const end = view.getUint32(g + 4);
          if (cp < start) hi = mid - 1;
          else if (cp > end) lo = mid + 1;
          else return view.getUint32(g + 8) + (cp - start);
        }
        return 0;
      };
    }
    if (format === 4 && platform === 3 && (encoding === 1 || encoding === 0)) format4 = sub;
  }
  if (format4 < 0) throw new Error('対応する cmap（format 4/12）がない');
  const sub = format4;
  const segX2 = view.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segX2; i += 2) {
      if (cp > view.getUint16(ends + i)) continue;
      const start = view.getUint16(starts + i);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + i);
      const rangeOffset = view.getUint16(rangeOffsets + i);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const glyph = view.getUint16(rangeOffsets + i + rangeOffset + (cp - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

export function loadFontMetrics(data: Uint8Array): FontMetrics {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = tableOffsets(view);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');
  if (head === undefined || hhea === undefined || hmtx === undefined || cmap === undefined) {
    throw new Error('head/hhea/hmtx/cmap のいずれかがないフォント');
  }
  const unitsPerEm = view.getUint16(head + 18);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const glyphOf = readCmap(view, cmap);
  const advance = (glyph: number): number =>
    view.getUint16(hmtx + Math.min(glyph, numberOfHMetrics - 1) * 4);
  const cache = new Map<number, number>();
  return {
    width(text, fontSize) {
      let units = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        let w = cache.get(cp);
        if (w === undefined) {
          w = advance(glyphOf(cp));
          cache.set(cp, w);
        }
        units += w;
      }
      return (units * fontSize) / unitsPerEm;
    },
  };
}

/** フォントが無いときの概算（全角 1em、半角 0.55em）。 */
export const approximateMetrics: FontMetrics = {
  width(text, fontSize) {
    let em = 0;
    for (const ch of text) em += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : 0.55;
    return em * fontSize;
  },
};
