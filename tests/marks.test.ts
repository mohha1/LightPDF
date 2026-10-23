import { describe, expect, it } from 'vitest';
import {
  arrowWings,
  markBounds,
  moveMark,
  PageView,
  placedBounds,
  placeIn,
  resizeMark,
  type ImageMark,
  type Mark,
  type TextMark,
} from '../src/core/marks';

const size = { width: 100, height: 200 };

const text: TextMark = {
  type: 'text',
  id: 't',
  text: 'Hello',
  font: 'sans',
  bold: false,
  size: 10,
  color: '#000000',
  x: 10,
  y: 20,
  width: 30,
  height: 12,
  angle: 0,
};

describe('PageView', () => {
  it('turns the page clockwise, corners included', () => {
    // The page's top-left corner ends up at the view's top-right after a quarter turn.
    expect(new PageView(size, 90).toView({ x: 0, y: 0 })).toEqual({ x: 200, y: 0 });
    expect(new PageView(size, 180).toView({ x: 0, y: 0 })).toEqual({ x: 100, y: 200 });
    expect(new PageView(size, 270).toView({ x: 0, y: 0 })).toEqual({ x: 0, y: 100 });
    expect(new PageView(size, 90).viewSize).toEqual({ width: 200, height: 100 });
    expect(new PageView(size, -90).rotation).toBe(270);
  });

  it('maps back what it maps forward, and its matrix agrees', () => {
    const point = { x: 12, y: 34 };
    for (const rotation of [0, 90, 180, 270]) {
      const view = new PageView(size, rotation);
      const turned = view.toView(point);
      expect(view.fromView(turned)).toEqual(point);
      const [a, b, c, d, e, f] = view.matrix;
      expect({ x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }).toEqual(turned);
    }
  });

  it('maps rectangles both ways', () => {
    const view = new PageView(size, 90);
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(view.rectToView(rect)).toEqual({ x: 140, y: 10, width: 40, height: 30 });
    expect(view.rectFromView(view.rectToView(rect))).toEqual(rect);
  });
});

describe('placed boxes', () => {
  it('cover the same area after being placed in it, at every angle', () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };
    for (const angle of [0, 90, 180, 270]) {
      const placed = placeIn(bounds, angle);
      expect(placedBounds(placed)).toEqual(bounds);
      // Turned sideways, the content's own width runs along the page's height.
      expect(placed.width).toBe(angle % 180 ? 40 : 30);
    }
  });

  it('text placed upright in a turned view reads upright there', () => {
    const view = new PageView(size, 90);
    const placed = placeIn(view.rectFromView({ x: 50, y: 10, width: 60, height: 12 }), -90);
    // The content's top-left corner is where the view shows the box's top-left.
    expect(view.toView(placed)).toEqual({ x: 50, y: 10 });
    expect(placed.width).toBe(60);
  });
});

describe('editing marks', () => {
  it('moves every kind of mark', () => {
    expect(markBounds(moveMark(text, 5, -5))).toMatchObject({ x: 15, y: 15 });
    const line: Mark = { type: 'line', id: 'l', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, arrow: true, color: '#000', lineWidth: 2 };
    expect(moveMark(line, 1, 2)).toMatchObject({ from: { x: 1, y: 2 }, to: { x: 11, y: 12 } });
    const ink: Mark = { type: 'ink', id: 'i', points: [{ x: 0, y: 0 }, { x: 4, y: 2 }], color: '#000', lineWidth: 2 };
    expect(markBounds(moveMark(ink, 10, 10))).toEqual({ x: 10, y: 10, width: 4, height: 2 });
  });

  it('scales text by its font size and keeps its angle', () => {
    const turned = { ...text, ...placeIn({ x: 10, y: 20, width: 12, height: 30 }, 90) };
    const resized = resizeMark(turned, { x: 10, y: 20, width: 24, height: 60 });
    expect(resized.size).toBe(20);
    expect(resized.angle).toBe(90);
    expect(placedBounds(resized)).toEqual({ x: 10, y: 20, width: 24, height: 60 });
  });

  it('stretches images and freehand lines into the new box', () => {
    const image: ImageMark = { type: 'image', id: 'm', image: { bytes: new Uint8Array(), kind: 'png' }, x: 0, y: 0, width: 10, height: 20, angle: 0 };
    expect(resizeMark(image, { x: 5, y: 5, width: 20, height: 40 })).toMatchObject({ x: 5, y: 5, width: 20, height: 40 });
    const ink: Mark = { type: 'ink', id: 'i', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: '#000', lineWidth: 2 };
    expect(resizeMark(ink, { x: 0, y: 0, width: 20, height: 0 }).points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });

  it('points arrowheads back along the line', () => {
    const [left, right] = arrowWings({ x: 0, y: 0 }, { x: 100, y: 0 }, 2);
    expect(left.x).toBeCloseTo(92);
    expect(right.x).toBeCloseTo(92);
    expect(left.y).toBeCloseTo(4);
    expect(right.y).toBeCloseTo(-4);
  });
});
