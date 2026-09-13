import { describe, it, expect } from "vitest";
import { graphGeometry, hitWidth } from "./eval-graph";

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

  it("spreads points across the full width, leaving room for the start", () => {
    // Position 0 is the starting position, before any move was played. The
    // first move therefore sits one step in, not hard against the left edge.
    const { points } = graphGeometry({
      points: [point(50, 1), point(50, 2), point(50, 3)],
      width: WIDTH,
      height: HEIGHT,
    });

    // Rounded to a hundredth of a pixel by design, so asserted to that.
    expect(points[0]!.x).toBeCloseTo(WIDTH / 3, 2);
    expect(points[2]!.x).toBeCloseTo(WIDTH, 2);
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

  it("spaces points so the graph reflects when moves were played", () => {
    // Points are laid out by their position in the game, not by their order in
    // the list, so a move without an evaluation leaves a gap rather than
    // silently compressing the timeline.
    const { points } = graphGeometry({
      points: [point(50, 1), point(50, 5)],
      width: WIDTH,
      height: HEIGHT,
      lastPositionIndex: 5,
    });

    expect(points[0]!.x).toBeCloseTo(WIDTH / 5, 5);
    expect(points[1]!.x).toBeCloseTo(WIDTH, 5);
  });

  it("returns nothing to draw when there are no points", () => {
    const geometry = graphGeometry({ points: [], width: WIDTH, height: HEIGHT });

    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
    expect(geometry.areaPath).toBe("");
  });
});

describe("hitWidth", () => {
  it("covers the gap between points, leaving no dead band", () => {
    // Click targets narrower than the spacing leave stripes of graph that
    // swallow a click, which reads as the graph being broken.
    const { points } = graphGeometry({
      points: [point(50, 1), point(50, 2), point(50, 3)],
      width: WIDTH,
      height: HEIGHT,
    });

    // Every gap, not just the first: rounding makes them differ slightly, and
    // the widest is the one that would leave a dead stripe.
    for (let i = 1; i < points.length; i += 1) {
      const gap = points[i]!.x - points[i - 1]!.x;
      expect(hitWidth(points, WIDTH)).toBeGreaterThanOrEqual(gap);
    }
  });

  it("covers the whole width when there is only one point", () => {
    const { points } = graphGeometry({
      points: [point(50, 1)],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(hitWidth(points, WIDTH)).toBeGreaterThanOrEqual(WIDTH);
  });
});

/**
 * Coordinates are rounded, and that is a correctness requirement rather than
 * tidiness.
 *
 * `whiteWinPct` comes from `winPct`, which is a logistic built on `Math.exp`.
 * The last bit of that is not guaranteed identical between the Node process
 * that server-renders the graph and the browser engine that hydrates it, so
 * the same evaluation can produce 60.782230092727296 on one and
 * 60.78223009272731 on the other. React compares the rendered attribute
 * strings, sees `cy="37.649059110981796"` against `cy="37.64905911098178"`,
 * and reports a hydration mismatch it will not patch up.
 *
 * Rounding to a precision far finer than a pixel but far coarser than a ULP
 * makes the two agree. Two decimal places on a 96px-tall graph is a hundredth
 * of a pixel — invisible, and stable.
 */
describe("coordinate precision", () => {
  const SAMPLES = [
    60.782230092727296, 60.78223009272731, 45.52783162621198,
    37.64905911098178, 1 / 3, 99.999999999999,
  ];

  it("emits coordinates with at most two decimal places", () => {
    const { points } = graphGeometry({
      points: SAMPLES.map((pct, i) => point(pct, i + 1)),
      width: 720,
      height: 96,
    });

    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      // A value with more than two decimals would round to something else.
      expect(p.x).toBe(Math.round(p.x * 100) / 100);
      expect(p.y).toBe(Math.round(p.y * 100) / 100);
    }
  });

  it("gives two evaluations a ULP apart the same coordinate", () => {
    // The actual failure: the same position, computed on two engines.
    const server = graphGeometry({
      points: [point(60.782230092727296, 23)],
      width: 720,
      height: 96,
    });
    const client = graphGeometry({
      points: [point(60.78223009272731, 23)],
      width: 720,
      height: 96,
    });

    expect(client.points[0]!.y).toBe(server.points[0]!.y);
    expect(client.linePath).toBe(server.linePath);
    expect(client.areaPath).toBe(server.areaPath);
  });

  it("rounds the paths too, not only the points", () => {
    const { linePath, areaPath } = graphGeometry({
      points: SAMPLES.map((pct, i) => point(pct, i + 1)),
      width: 720,
      height: 96,
    });

    for (const path of [linePath, areaPath]) {
      for (const n of path.match(/-?\d+\.\d+/g) ?? []) {
        expect(n.split(".")[1]!.length, `${n} in ${path}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("still places a balanced position on the centre line", () => {
    // Rounding must not move anything that matters.
    const { points, midline } = graphGeometry({
      points: [point(50, 1)],
      width: 720,
      height: 96,
    });
    expect(points[0]!.y).toBe(midline);
  });
});
