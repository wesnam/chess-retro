import { describe, it, expect } from "vitest";
import { graphGeometry } from "./eval-graph";

/**
 * The graph's geometry, separated from its SVG so the mapping from win
 * percentage to a drawn point can be asserted.
 */

const WIDTH = 100;
const HEIGHT = 40;

function point(whiteWinPct: number, positionIndex: number) {
  return {
    positionIndex,
    whiteWinPct,
    classification: null,
    isUserMove: true,
  };
}

describe("graphGeometry", () => {
  it("puts a balanced position on the centre line", () => {
    const { points } = graphGeometry({
      points: [point(50, 1)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(points[0]!.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it("draws White winning above the centre line", () => {
    // SVG y grows downward, so White being better must give a SMALLER y.
    // Getting this backwards flips the whole graph without any error.
    const { points } = graphGeometry({
      points: [point(90, 1)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(points[0]!.y).toBeLessThan(HEIGHT / 2);
  });

  it("draws Black winning below the centre line", () => {
    const { points } = graphGeometry({
      points: [point(10, 1)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(points[0]!.y).toBeGreaterThan(HEIGHT / 2);
  });

  it("spreads points across the full width", () => {
    const { points } = graphGeometry({
      points: [point(50, 1), point(50, 2), point(50, 3)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(points[0]!.x).toBeCloseTo(0, 5);
    expect(points[2]!.x).toBeCloseTo(WIDTH, 5);
  });

  it("keeps a single point inside the box rather than dividing by zero", () => {
    const { points } = graphGeometry({
      points: [point(50, 1)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(Number.isFinite(points[0]!.x)).toBe(true);
    expect(points[0]!.x).toBeGreaterThanOrEqual(0);
    expect(points[0]!.x).toBeLessThanOrEqual(WIDTH);
  });

  it("stays within the box at the extremes", () => {
    const { points } = graphGeometry({
      points: [point(0, 1), point(100, 2)],
      width: WIDTH,
      height: HEIGHT,
    });

    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("carries the position index through, so a click can jump to the move", () => {
    const { points } = graphGeometry({
      points: [point(50, 7)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(points[0]!.positionIndex).toBe(7);
  });

  it("produces an area path that closes along the centre line", () => {
    // The fill sits between the curve and the balance line, so the shaded area
    // reads as "how far from equal", not "how far from the bottom".
    const { areaPath } = graphGeometry({
      points: [point(90, 1), point(10, 2)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(areaPath).toContain(`L ${WIDTH} ${HEIGHT / 2}`);
    expect(areaPath.endsWith("Z")).toBe(true);
  });

  it("returns nothing to draw when there are no points", () => {
    const geometry = graphGeometry({ points: [], width: WIDTH, height: HEIGHT });

    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
    expect(geometry.areaPath).toBe("");
  });
});
