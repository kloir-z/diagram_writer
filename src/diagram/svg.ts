// レイアウト結果 → SVG（確認用のプレビュー）。
// Copilot のコード実行環境には draw.io の描画処理が無いので、レイアウト結果から自前で SVG を書き、Chromium で PNG にする。
// 見た目は drawio.ts の出力（draw.io で開いたとき）に近づけてあるが、正は .drawio。細部（角の丸み、矢じりの形）は少し違う。
import { LEGEND } from './layout.ts';
import { containerStyle, EDGE_THEME, FONT_M, FONT_P, LEAF_SWATCH, LINE_HEIGHT, NOTE_STYLE } from './theme.ts';
import type { Box, ContainerKind, LaidEdge, LaidNode, Layout, LeafKind, Point, TextLine, Tone } from './types.ts';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r = (n: number): number => Math.round(n * 100) / 100;
const FAMILY_P = `'${FONT_P}', 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif`;
const FAMILY_M = `'${FONT_M}', 'Noto Sans Mono CJK JP', monospace`;

/** 行を、上端 top から順に置く。anchor は横の基準（start：x から右へ、middle：x を中心に） */
function text(lines: TextLine[], x: number, top: number, anchor: 'start' | 'middle'): string {
  let y = top;
  return lines
    .map((l) => {
      const h = l.size * LINE_HEIGHT;
      const out =
        `<text x="${r(x)}" y="${r(y + h / 2)}" dominant-baseline="central" text-anchor="${anchor}" ` +
        `font-family="${esc(l.font === 'm' ? FAMILY_M : FAMILY_P)}" font-size="${l.size}" fill="${l.color}"${l.bold ? ' font-weight="bold"' : ''}>${esc(l.text)}</text>`;
      y += h;
      return out;
    })
    .join('');
}

const height = (lines: TextLine[]): number => lines.reduce((s, l) => s + l.size * LINE_HEIGHT, 0);

function nodeSvg(n: LaidNode): string {
  const b = n.box;
  if (n.kind === 'note') {
    const f = 10;
    const shape = `M${r(b.x)},${r(b.y)} H${r(b.x + b.w - f)} L${r(b.x + b.w)},${r(b.y + f)} V${r(b.y + b.h)} H${r(b.x)} Z`;
    const fold = `M${r(b.x + b.w - f)},${r(b.y)} V${r(b.y + f)} H${r(b.x + b.w)}`;
    return (
      `<path d="${shape}" fill="${NOTE_STYLE.fill}" stroke="${NOTE_STYLE.stroke}"/><path d="${fold}" fill="none" stroke="${NOTE_STYLE.stroke}"/>` +
      text(n.lines, b.x + 10, b.y + (b.h - height(n.lines)) / 2, 'start')
    );
  }
  if (n.container) {
    const s = containerStyle(n.kind as ContainerKind, n.tone);
    const header = n.header?.box ?? { x: b.x + 14, y: b.y + 8, w: 0, h: 0 };
    return (
      `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="7" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}"${s.dashed ? ' stroke-dasharray="8 4"' : ''}/>` +
      text(n.lines, header.x, header.y, 'start')
    );
  }
  const s = LEAF_SWATCH[n.kind as LeafKind];
  return (
    `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" rx="5" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${n.emphasis ? 3 : 1.2}"/>` +
    text(n.lines, b.x + b.w / 2, b.y + (b.h - height(n.lines)) / 2, 'middle')
  );
}

/** 折れ線を、曲がり角を少し丸めた path にする（draw.io の rounded=1 に近い見た目） */
function roundedPath(points: Point[]): string {
  const radius = 8;
  let d = `M${r(points[0].x)},${r(points[0].y)}`;
  for (let k = 1; k < points.length - 1; k++) {
    const [p, q, s] = [points[k - 1], points[k], points[k + 1]];
    const toward = (a: Point, c: Point, len: number): Point => {
      const dist = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      return { x: a.x + ((c.x - a.x) / dist) * len, y: a.y + ((c.y - a.y) / dist) * len };
    };
    const rad = Math.min(radius, Math.hypot(q.x - p.x, q.y - p.y) / 2, Math.hypot(s.x - q.x, s.y - q.y) / 2);
    const a = toward(q, p, rad);
    const c = toward(q, s, rad);
    d += ` L${r(a.x)},${r(a.y)} Q${r(q.x)},${r(q.y)} ${r(c.x)},${r(c.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${r(last.x)},${r(last.y)}`;
}

/** 線の端 tip に、from から tip へ向かう矢じりを描く */
function head(kind: 'block' | 'open' | 'cross', from: Point, tip: Point, color: string, size: number): string {
  const dist = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / dist;
  const uy = (tip.y - from.y) / dist;
  const back = { x: tip.x - ux * size * 1.6, y: tip.y - uy * size * 1.6 };
  const left = { x: back.x - uy * size * 0.7, y: back.y + ux * size * 0.7 };
  const right = { x: back.x + uy * size * 0.7, y: back.y - ux * size * 0.7 };
  if (kind === 'block') return `<path d="M${r(tip.x)},${r(tip.y)} L${r(left.x)},${r(left.y)} L${r(right.x)},${r(right.y)} Z" fill="${color}" stroke="${color}"/>`;
  if (kind === 'open') return `<path d="M${r(left.x)},${r(left.y)} L${r(tip.x)},${r(tip.y)} L${r(right.x)},${r(right.y)}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  const c = { x: tip.x - ux * size, y: tip.y - uy * size };
  const h = size * 0.6;
  return (
    `<path d="M${r(c.x - h)},${r(c.y - h)} L${r(c.x + h)},${r(c.y + h)} M${r(c.x - h)},${r(c.y + h)} L${r(c.x + h)},${r(c.y - h)}" stroke="${color}" stroke-width="1.5"/>`
  );
}

function lineSvg(cls: LaidEdge['cls'], dir: LaidEdge['dir'], emphasis: boolean, points: Point[], arrow: number): string {
  if (points.length < 2) return '';
  const t = EDGE_THEME[cls];
  const n = points.length;
  if (t.fat) {
    // 太い矢印：外側の線と内側の塗りを重ね、先に三角を付ける
    const w = emphasis ? 18 : 12;
    const tip = points[n - 1];
    const prev = points[n - 2];
    const dist = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const body = [...points.slice(0, -1), { x: tip.x - ((tip.x - prev.x) / dist) * w, y: tip.y - ((tip.y - prev.y) / dist) * w }];
    return (
      `<path d="${roundedPath(body)}" fill="none" stroke="${t.color}" stroke-width="${w + 2}"/>` +
      `<path d="${roundedPath(body)}" fill="none" stroke="#eeeeee" stroke-width="${w - 1}"/>` +
      head('block', prev, tip, '#eeeeee', w * 0.8).replace(`stroke="#eeeeee"`, `stroke="${t.color}" stroke-width="1.5"`)
    );
  }
  const width = emphasis ? t.width + 1.5 : t.width;
  const end = cls === 'blocked' ? 'cross' : cls === 'note' || dir === 'none' ? null : t.arrow ?? 'block';
  return (
    `<path d="${roundedPath(points)}" fill="none" stroke="${t.color}" stroke-width="${width}"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''}/>` +
    (end ? head(end, points[n - 2], points[n - 1], t.color, arrow) : '') +
    (dir === 'both' && end ? head(end === 'cross' ? 'block' : end, points[1], points[0], t.color, arrow) : '')
  );
}

function edgeSvg(e: LaidEdge): string {
  let out = lineSvg(e.cls, e.dir, e.emphasis, e.points, e.emphasis ? 6 : 5);
  if (e.label) {
    const b = e.label.box;
    out += `<rect x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" fill="#ffffff"/>`;
    out += text(e.label.lines, b.x + b.w / 2, b.y + (b.h - height(e.label.lines)) / 2, 'middle');
  }
  return out;
}

function legendSvg(layout: Layout): string {
  if (!layout.legend) return '';
  const lb = layout.legend.box;
  let out =
    `<rect x="${r(lb.x)}" y="${r(lb.y)}" width="${r(lb.w)}" height="${r(lb.h)}" rx="5" fill="#ffffff" stroke="#cccccc"/>` +
    text([{ text: LEGEND.title, font: 'p', size: 12, bold: true, color: '#1a1a1a' }], lb.x + 14, lb.y + 6, 'start');
  for (const { item, box } of layout.legend.items) {
    const sample: Box = { x: box.x, y: box.y + 2, w: LEGEND.sampleW, h: box.h - 4 };
    if (item.type === 'node') {
      const s = LEAF_SWATCH[item.key as LeafKind];
      out += `<rect x="${r(sample.x)}" y="${r(sample.y)}" width="${sample.w}" height="${r(sample.h)}" rx="3" fill="${s.fill}" stroke="${s.stroke}"/>`;
    } else if (item.type === 'zone') {
      const s = containerStyle('zone', item.key as Tone);
      out += `<rect x="${r(sample.x)}" y="${r(sample.y)}" width="${sample.w}" height="${r(sample.h)}" rx="3" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-dasharray="8 4"/>`;
    } else {
      const y = sample.y + sample.h / 2;
      out += lineSvg(item.key as LaidEdge['cls'], 'forward', false, [{ x: sample.x, y }, { x: sample.x + sample.w, y }], 4);
    }
    out += text([{ text: item.label, font: 'p', size: 11, bold: false, color: '#333333' }], box.x + LEGEND.sampleW + 10, box.y + (box.h - 11 * LINE_HEIGHT) / 2, 'start');
  }
  return out;
}

export function toSvg(layout: Layout): string {
  const w = Math.ceil(layout.width);
  const h = Math.ceil(layout.height);
  const parts = [
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`,
    text(layout.title.lines, layout.title.box.x, layout.title.box.y, 'start'),
    // draw.io と同じ重ね順：要素（親の枠が先）→ 線 → 凡例
    ...layout.nodes.map(nodeSvg),
    ...layout.edges.map(edgeSvg),
    legendSvg(layout),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${parts.join('\n')}\n</svg>\n`;
}
