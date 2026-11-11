import { describe, expect, it } from 'vitest';
import {
  alignRects, crc32, distributeRects, fitZoom, formatDistance, formatScale, mmToDevicePx, mmToPx, niceFloor, niceScaleBar, NOMINAL_PX_PER_MM,
  parseScale, pngWithDpi, ptToMm, pxToMm, resizeRect, snapMove, snapTargets, snapToGrid, snapValue, substituteTokens,
} from './geometry';

describe('unit conversions', () => {
  it('converts mm, px, pt and dpi', () => {
    expect(mmToPx(10, 2)).toBe(20);
    expect(pxToMm(20, 2)).toBe(10);
    expect(ptToMm(72)).toBeCloseTo(25.4);
    expect(NOMINAL_PX_PER_MM * 25.4).toBeCloseTo(96);
    expect(mmToDevicePx(210, 300)).toBe(2480); // A4 width at 300 dpi
    expect(mmToDevicePx(297, 96)).toBe(1123);
  });
  it('fits a page into a viewport', () => {
    expect(fitZoom({ width: 100, height: 50 }, { width: 248, height: 1000 }, 24)).toBeCloseTo(2);
  });
});

describe('scale bar divisions', () => {
  it('picks nice numbers', () => {
    expect(niceFloor(7.3)).toBe(5);
    expect(niceFloor(2.6)).toBe(2.5);
    expect(niceFloor(1999)).toBe(1000);
    expect(niceFloor(0.034)).toBeCloseTo(0.025);
  });
  it('uses km for long bars and keeps within width', () => {
    // 1:50,000, 60 mm available -> 3 km on the ground; 4 segments of 0.5 km = 2 km
    const s = niceScaleBar(50000, 60, 'metric', 4)!;
    expect(s.unit).toBe('km');
    expect(s.segmentValue).toBe(0.5);
    expect(s.total).toBe(2);
    expect(s.segmentMm).toBeCloseTo(10);
    expect(s.segmentMm * s.segments).toBeLessThanOrEqual(60);
  });
  it('uses metres for short bars', () => {
    const s = niceScaleBar(1000, 50, 'metric', 5)!; // 50 m available
    expect(s.unit).toBe('m');
    expect(s.segmentValue).toBe(10);
    expect(s.segmentMm).toBeCloseTo(10);
  });
  it('switches feet to miles', () => {
    expect(niceScaleBar(1000, 50, 'imperial', 4)!.unit).toBe('ft');
    const mi = niceScaleBar(250000, 80, 'imperial', 4)!; // ~12.4 mi available
    expect(mi.unit).toBe('mi');
    expect(mi.total).toBe(10);
  });
  it('rejects bad input', () => {
    expect(niceScaleBar(0, 50, 'metric')).toBeNull();
    expect(niceScaleBar(1000, 0, 'metric')).toBeNull();
  });
  it('formats scales and distances', () => {
    expect(formatScale(50123)).toBe('1:50,100');
    expect(formatScale(512)).toBe('1:512');
    expect(formatDistance(2.5)).toBe('2.5');
    expect(formatDistance(0.30000000000000004)).toBe('0.3');
    expect(parseScale('1:25,000')).toBe(25000);
    expect(parseScale(' 1 : 10 000 ')).toBe(10000);
    expect(parseScale('abc')).toBeNull();
  });
});

describe('tokens', () => {
  it('substitutes known tokens case-insensitively and keeps unknown ones', () => {
    expect(substituteTokens('{Map} at {scale} by {nobody}', { map: 'Roads', scale: '1:5,000' })).toBe('Roads at 1:5,000 by {nobody}');
  });
});

describe('snapping', () => {
  const page = { width: 200, height: 100 };
  it('snaps a moving rect to the page centre', () => {
    const t = snapTargets(page, []);
    const r = snapMove({ x: 88, y: 10, w: 20, h: 10 }, t, 3);
    expect(r.dx).toBeCloseTo(2); // centre 98 -> 100
    expect(r.guideX).toBe(100);
  });
  it('snaps to other elements and margins', () => {
    const t = snapTargets(page, [{ x: 50, y: 50, w: 10, h: 10 }], 10);
    expect(snapMove({ x: 61, y: 0.5, w: 5, h: 5 }, t, 2)).toMatchObject({ dx: -1, guideX: 60, dy: -0.5, guideY: 0 });
    expect(snapValue(9.2, t.xs, 1)).toEqual({ value: 10, guide: 10 });
    expect(snapValue(30, t.xs, 1)).toEqual({ value: 30, guide: null });
  });
  it('snaps to a grid', () => {
    expect(snapToGrid(12.4, 5)).toBe(10);
    expect(snapToGrid(12.6, 5)).toBe(15);
  });
});

describe('resize', () => {
  const r = { x: 10, y: 10, w: 40, h: 20 };
  it('resizes from corners and edges', () => {
    expect(resizeRect(r, 'se', 10, 5, false)).toEqual({ x: 10, y: 10, w: 50, h: 25 });
    expect(resizeRect(r, 'nw', 5, 5, false)).toEqual({ x: 15, y: 15, w: 35, h: 15 });
    expect(resizeRect(r, 'w', 100, 0, false, 1)).toEqual({ x: 49, y: 10, w: 1, h: 20 });
  });
  it('keeps aspect ratio', () => {
    const k = resizeRect(r, 'se', 40, 0, true);
    expect(k.w / k.h).toBeCloseTo(2);
    expect(k.w).toBe(80);
    const e = resizeRect(r, 'e', 20, 0, true);
    expect(e).toEqual({ x: 10, y: 5, w: 60, h: 30 });
  });
});

describe('align and distribute', () => {
  const rects = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 30, y: 5, w: 20, h: 10 },
    { x: 90, y: 2, w: 10, h: 10 },
  ];
  it('aligns to the selection bounds', () => {
    expect(alignRects(rects, 'right').map((p) => p.x)).toEqual([90, 80, 90]);
    expect(alignRects(rects, 'top').map((p) => p.y)).toEqual([0, 0, 0]);
    expect(alignRects([rects[0]], 'hcenter', { x: 0, y: 0, w: 200, h: 100 })[0].x).toBe(95);
  });
  it('distributes with equal gaps', () => {
    const d = distributeRects(rects, 'h');
    expect(d.map((p) => p.x)).toEqual([0, 40, 90]); // gaps of 30
  });
});

describe('png dpi', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
  it('inserts a pHYs chunk after IHDR', () => {
    const ihdr = [0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89];
    const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82];
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...ihdr, ...iend]);
    const out = pngWithDpi(png, 300);
    expect(out.length).toBe(png.length + 21);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    const view = new DataView(out.buffer);
    expect(view.getUint32(41)).toBe(11811); // 300 dpi in px per metre
    expect(pngWithDpi(out, 150).length).toBe(out.length); // replaces, not duplicates
  });
});
