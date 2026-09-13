import type { ReviewGraphPoint } from "@/games/review-model";

/**
 * Geometry for the evaluation graph, kept apart from the SVG that draws it.
 *
 * The one thing worth pinning: SVG's y axis grows downward, so White being
 * better must produce a SMALLER y. Getting that backwards flips the entire
 * graph with no error to notice.
 *
 * Every coordinate is rounded on the way out, which is a correctness
 * requirement rather than tidiness — see `round2`.
 */

/**
 * Coordinates, to a hundredth of a pixel.
 *
 * `whiteWinPct` comes from a logistic built on `Math.exp`, whose last bit is
 * not guaranteed identical between the Node process that server-renders this
 * graph and the browser engine that hydrates it. One position genuinely
 * produced 60.782230092727296 on the server and 60.78223009272731 on the
 * client, React compared `cy="37.649059110981796"` with `cy="37.64905911098178"`,
 * and reported a hydration mismatch it does not patch up.
 *
 * Two decimals on a 96px graph is a hundredth of a pixel: far below anything
 * visible, far above a ULP, and identical on both sides.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type GraphPoint = ReviewGraphPoint & { x: number; y: number };

export type GraphGeometry = {
  points: GraphPoint[];
  /** The evaluation curve. */
  linePath: string;
  /** The curve closed back along the centre line, for the shaded area. */
  areaPath: string;
  /** Where an even position sits, in the same coordinates. */
  midline: number;
};

export function graphGeometry({
  points,
  width,
  height,
  lastPositionIndex,
}: {
  points: ReviewGraphPoint[];
  width: number;
  height: number;
  /**
   * The last position in the game. Points are spaced along this rather than by
   * their order in the list, so a move with no evaluation leaves a gap instead
   * of compressing the timeline into something that misreads as faster play.
   */
  lastPositionIndex?: number;
}): GraphGeometry {
  const midline = round2(height / 2);

  if (points.length === 0) {
    return { points: [], linePath: "", areaPath: "", midline };
  }

  const finalIndex = lastPositionIndex ?? points.at(-1)!.positionIndex;
  // A single point at index 0 would otherwise divide by zero.
  const span = Math.max(1, finalIndex);

  const placed: GraphPoint[] = points.map((point) => ({
    ...point,
    x: round2((point.positionIndex / span) * width),
    // 100% for White is the top of the box, 0% the bottom.
    y: round2(height - (point.whiteWinPct / 100) * height),
  }));

  const linePath = placed
    .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  // Closed along the midline rather than the bottom, so the shaded area reads
  // as distance from equality rather than distance from zero.
  const first = placed[0]!;
  const last = placed.at(-1)!;
  const areaPath = `M ${first.x} ${midline} ${placed
    .map((p) => `L ${p.x} ${p.y}`)
    .join(" ")} L ${last.x} ${midline} Z`;

  return { points: placed, linePath, areaPath, midline };
}

/**
 * Width of a click target on the graph.
 *
 * Sized to the real spacing between points and rounded up, so adjacent targets
 * overlap slightly rather than leaving dead stripes that swallow a click.
 */
export function hitWidth(points: GraphPoint[], width: number): number {
  if (points.length < 2) return width;

  // The WIDEST gap, not the average one. Coordinates are rounded, so gaps that
  // are equal in theory differ by up to a hundredth of a pixel in practice —
  // and an average sized to fit most of them leaves the largest uncovered,
  // which is exactly the dead stripe this function exists to prevent.
  let widest = 0;
  for (let i = 1; i < points.length; i += 1) {
    widest = Math.max(widest, points[i]!.x - points[i - 1]!.x);
  }

  return Math.max(widest, width / points.length);
}
