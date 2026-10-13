// レイアウト結果 → draw.io（mxfile）。人が diagrams.net で開いて直せるよう、
// 入れ子はコンテナ（親子セル）、線は機器セルに接続し、ELK の折れ点をそのまま waypoint にする。
import { HEADER_INSET_X, HEADER_INSET_Y, LEGEND } from './layout.ts';
import { containerStyle, EDGE_THEME, FONT_M, FONT_P, FONT_SOURCE_P, LEAF_SWATCH, NOTE_STYLE } from './theme.ts';
import type { Box, ContainerKind, LaidEdge, LaidNode, Layout, LeafKind, Point, TextLine, Tone } from './types.ts';

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r = (n: number): number => Math.round(n * 100) / 100;
const ROOT = 'dw:root';
const LAYER = 'dw:layer';
const LEGEND_ID = 'dw:legend';

function html(lines: TextLine[]): string {
  return lines
    .map((l) => {
      const css = [
        `font-size:${l.size}px`,
        `color:${l.color}`,
        l.bold ? 'font-weight:bold' : '',
        l.font === 'm' ? `font-family:${FONT_M}` : '',
      ].filter(Boolean).join(';');
      return `<span style="${css}">${htmlEscape(l.text)}</span>`;
    })
    .join('<br>');
}

const FONT = `fontFamily=${FONT_P};fontSource=${FONT_SOURCE_P};`;

function style(parts: Record<string, string | number | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
    .join(';') + ';';
}

function geometry(box: Box, parent: Box | null): string {
  const x = parent ? box.x - parent.x : box.x;
  const y = parent ? box.y - parent.y : box.y;
  return `<mxGeometry x="${r(x)}" y="${r(y)}" width="${r(box.w)}" height="${r(box.h)}" as="geometry" />`;
}

function nodeStyle(n: LaidNode): string {
  if (n.kind === 'note') {
    return style({ shape: 'note', size: 10, whiteSpace: 'wrap', html: 1, fillColor: NOTE_STYLE.fill, strokeColor: NOTE_STYLE.stroke, align: 'left', verticalAlign: 'middle', spacingLeft: 10, spacingRight: 8 }) + FONT;
  }
  if (n.container) {
    const s = containerStyle(n.kind as ContainerKind, n.tone);
    return style({
      rounded: 1, absoluteArcSize: 1, arcSize: 14, container: 1, collapsible: 0, recursiveResize: 0, html: 1, whiteSpace: 'wrap',
      fillColor: s.fill, strokeColor: s.stroke, strokeWidth: s.strokeWidth, dashed: s.dashed ? 1 : 0, dashPattern: s.dashed ? '8 4' : undefined,
      align: 'left', verticalAlign: 'top', spacingLeft: r((n.header?.box.x ?? n.box.x + HEADER_INSET_X) - n.box.x), spacingRight: HEADER_INSET_X, spacingTop: HEADER_INSET_Y,
    }) + FONT;
  }
  const s = LEAF_SWATCH[n.kind as LeafKind];
  return style({
    rounded: 1, absoluteArcSize: 1, arcSize: 10, whiteSpace: 'wrap', html: 1,
    fillColor: s.fill, strokeColor: s.stroke, strokeWidth: n.emphasis ? 3 : 1.2,
    align: 'center', verticalAlign: 'middle', spacing: 4,
  }) + FONT;
}

/** 線の見た目（線種・矢じり・太い矢印）。図の線と凡例の見本で共通 */
function lineStyle(cls: LaidEdge['cls'], dir: LaidEdge['dir'], emphasis: boolean, arrowSize: number): Record<string, string | number | undefined> {
  const t = EDGE_THEME[cls];
  const head = t.arrow ?? 'block';
  const fill = t.arrow === 'open' ? 0 : 1;
  if (t.fat) {
    // 太い矢印（draw.io の flexArrow）。線の太さではなく、矢印の幅で強さを表す
    return {
      shape: 'flexArrow', fillColor: '#eeeeee', strokeColor: t.color, strokeWidth: t.width,
      width: emphasis ? 18 : 12, endWidth: emphasis ? 14 : 10, endSize: emphasis ? 7 : 5, endArrow: 'block', startArrow: dir === 'both' ? 'block' : 'none',
    };
  }
  return {
    strokeColor: t.color, strokeWidth: emphasis ? t.width + 1.5 : t.width,
    dashed: t.dash ? 1 : 0, dashPattern: t.dash ?? undefined,
    endArrow: cls === 'blocked' ? 'cross' : cls === 'note' || dir === 'none' ? 'none' : head, endFill: fill, endSize: arrowSize,
    startArrow: dir === 'both' ? head : 'none', startFill: fill, startSize: arrowSize,
  };
}

function edgeStyle(e: LaidEdge, src: Box | null, dst: Box | null): string {
  const first = e.points[0];
  const last = e.points[e.points.length - 1];
  const rel = (p: Point, b: Box): [number, number] => [Math.round(((p.x - b.x) / b.w) * 1000) / 1000, Math.round(((p.y - b.y) / b.h) * 1000) / 1000];
  const [exitX, exitY] = src ? rel(first, src) : [undefined, undefined];
  const [entryX, entryY] = dst ? rel(last, dst) : [undefined, undefined];
  return style({
    edgeStyle: 'orthogonalEdgeStyle', rounded: 1, html: 1,
    ...lineStyle(e.cls, e.dir, e.emphasis, 8),
    exitX, exitY, exitDx: 0, exitDy: 0, exitPerimeter: 0,
    entryX, entryY, entryDx: 0, entryDy: 0, entryPerimeter: 0,
    labelBackgroundColor: '#ffffff', fontSize: 11, fontColor: '#333333',
  }) + FONT;
}

/** 折れ線の長さの中点（draw.io は相対位置 x=0 のラベルをここに置く） */
function pathMidpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : half / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    half -= lengths[i];
  }
  return points[points.length - 1];
}

export function toDrawio(layout: Layout, name: string): string {
  // 道具が作るセルの id には、記述の id に使えない「:」を入れる（記述の要素の id と重ならない）
  const cells: string[] = [`<mxCell id="${ROOT}" />`, `<mxCell id="${LAYER}" parent="${ROOT}" />`];
  const boxes = new Map<string, Box>(layout.nodes.map((n) => [n.id, n.box]));

  cells.push(
    `<mxCell id="dw:title" value="${xmlEscape(html(layout.title.lines))}" style="${style({ text: '', html: 1, align: 'left', verticalAlign: 'top', whiteSpace: 'nowrap', spacing: 0 }) + FONT}" vertex="1" parent="${LAYER}">` +
      `${geometry({ ...layout.title.box, w: layout.title.box.w + 20 }, null)}</mxCell>`,
  );

  for (const n of layout.nodes) {
    const parent = n.parent ? boxes.get(n.parent) ?? null : null;
    cells.push(
      `<mxCell id="${xmlEscape(n.id)}" value="${xmlEscape(html(n.lines))}" style="${xmlEscape(nodeStyle(n))}" vertex="1" parent="${xmlEscape(n.parent ?? LAYER)}">${geometry(n.box, parent)}</mxCell>`,
    );
  }

  for (const e of layout.edges) {
    const bends = e.points.slice(1, -1).map((p) => `<mxPoint x="${r(p.x)}" y="${r(p.y)}" />`).join('');
    let offset = '';
    if (e.label) {
      const mid = pathMidpoint(e.points);
      const cx = e.label.box.x + e.label.box.w / 2;
      const cy = e.label.box.y + e.label.box.h / 2;
      offset = `<mxPoint x="${r(cx - mid.x)}" y="${r(cy - mid.y)}" as="offset" />`;
    }
    cells.push(
      `<mxCell id="${xmlEscape(e.id)}" value="${e.label ? xmlEscape(html(e.label.lines)) : ''}" style="${xmlEscape(edgeStyle(e, boxes.get(e.from) ?? null, boxes.get(e.to) ?? null))}" edge="1" parent="${LAYER}" source="${xmlEscape(e.from)}" target="${xmlEscape(e.to)}">` +
        `<mxGeometry relative="1" as="geometry">${bends ? `<Array as="points">${bends}</Array>` : ''}${offset}</mxGeometry></mxCell>`,
    );
  }

  if (layout.legend) {
    const lb = layout.legend.box;
    cells.push(
      `<mxCell id="${LEGEND_ID}" value="${xmlEscape(`<span style="font-size:12px;font-weight:bold">${LEGEND.title}</span>`)}" style="${xmlEscape(style({ rounded: 1, absoluteArcSize: 1, arcSize: 10, container: 1, collapsible: 0, html: 1, fillColor: '#ffffff', strokeColor: '#cccccc', align: 'left', verticalAlign: 'top', spacingLeft: 14, spacingTop: 4 }) + FONT)}" vertex="1" parent="${LAYER}">${geometry(lb, null)}</mxCell>`,
    );
    layout.legend.items.forEach(({ item, box }, i) => {
      const id = `${LEGEND_ID}:${i + 1}`;
      const sample: Box = { x: box.x, y: box.y + 2, w: LEGEND.sampleW, h: box.h - 4 };
      if (item.type === 'node') {
        const s = LEAF_SWATCH[item.key as LeafKind];
        cells.push(`<mxCell id="${id}:swatch" value="" style="${style({ rounded: 1, absoluteArcSize: 1, arcSize: 6, fillColor: s.fill, strokeColor: s.stroke })}" vertex="1" parent="${LEGEND_ID}">${geometry(sample, lb)}</mxCell>`);
      } else if (item.type === 'zone') {
        const s = containerStyle('zone', item.key as Tone);
        cells.push(
          `<mxCell id="${id}:swatch" value="" style="${style({ rounded: 1, absoluteArcSize: 1, arcSize: 6, fillColor: s.fill, strokeColor: s.stroke, strokeWidth: s.strokeWidth, dashed: 1, dashPattern: '8 4' })}" vertex="1" parent="${LEGEND_ID}">${geometry(sample, lb)}</mxCell>`,
        );
      } else {
        const cls = item.key as LaidEdge['cls'];
        const y = r(sample.y + sample.h / 2 - lb.y);
        cells.push(
          `<mxCell id="${id}:line" value="" style="${xmlEscape(style({ html: 1, ...lineStyle(cls, 'forward', false, 6) }))}" edge="1" parent="${LEGEND_ID}">` +
            `<mxGeometry relative="1" as="geometry"><mxPoint x="${r(sample.x - lb.x)}" y="${y}" as="sourcePoint" /><mxPoint x="${r(sample.x - lb.x + sample.w)}" y="${y}" as="targetPoint" /></mxGeometry></mxCell>`,
        );
      }
      cells.push(
        `<mxCell id="${id}:text" value="${xmlEscape(htmlEscape(item.label))}" style="${style({ text: '', html: 1, align: 'left', verticalAlign: 'middle', fontSize: 11, fontColor: '#333333', spacing: 0 }) + FONT}" vertex="1" parent="${LEGEND_ID}">${geometry({ x: box.x + LEGEND.sampleW + 10, y: box.y, w: box.w - LEGEND.sampleW - 10, h: box.h }, lb)}</mxCell>`,
      );
    });
  }

  return (
    `<mxfile host="diagram_writer">\n<diagram id="${xmlEscape(name)}" name="${xmlEscape(name)}">\n` +
    `<mxGraphModel grid="1" gridSize="10" guides="1" page="0" background="#ffffff" math="0" shadow="0">\n<root>\n${cells.join('\n')}\n</root>\n</mxGraphModel>\n</diagram>\n</mxfile>\n`
  );
}
