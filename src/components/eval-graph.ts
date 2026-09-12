import type { ReviewGraphPoint } from "@/games/review-model";

/**
 * Geometry for the evaluation graph, kept apart from the SVG that draws it.
 *
 * The one thing worth pinning: SVG's y axis grows downward, so White being
 * better must produce a SMALLER y. Getting that backwards flips the entire
 * graph with no error to notice.
 */

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
}: {
  points: ReviewGraphPoint[];
  width: number;
  height: number;
}): GraphGeometry {
  const midline = height / 2;

  if (points.length === 0) {
    return { points: [], linePath: "", areaPath: "", midline };
  }

  // A single point would otherwise divide by zero; put it at the left edge.
  const span = Math.max(1, points.length - 1);

  const placed: GraphPoint[] = points.map((point, index) => ({
    ...point,
    x: (index / span) * width,
    // 100% for White is the top of the box, 0% the bottom.
    y: height - (point.whiteWinPct / 100) * height,
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
