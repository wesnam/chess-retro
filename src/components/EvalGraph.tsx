"use client";

import { useId, useMemo } from "react";
import { graphGeometry, hitWidth } from "./eval-graph";
import type { ReviewGraphPoint } from "@/games/review-model";

const WIDTH = 720;
const HEIGHT = 96;

/**
 * Evaluation across the whole game, so the reviewer can see where it turned.
 *
 * Drawn in a fixed viewBox and scaled by CSS, so the geometry never has to
 * measure the DOM.
 */
export function EvalGraph({
  points,
  current,
  lastPositionIndex,
  orientation = "white",
  onSelect,
}: {
  points: ReviewGraphPoint[];
  current: number;
  lastPositionIndex: number;
  /** Which side the reviewer played; they occupy the top half either way. */
  orientation?: "white" | "black";
  onSelect: (positionIndex: number) => void;
}) {
  // Clip paths are referenced by id, which is document-global. Two graphs on
  // one page sharing an id would clip the second against the first.
  const id = useId();

  const geometry = useMemo(
    () =>
      graphGeometry({
        points,
        width: WIDTH,
        height: HEIGHT,
        lastPositionIndex,
        orientation,
      }),
    [points, lastPositionIndex, orientation],
  );

  if (geometry.points.length === 0) return null;

  const currentPoint = geometry.points.find((p) => p.positionIndex === current);

  return (
    <div className="eval-graph">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Evaluation across the game"
      >
        {/*
          The fill is drawn twice, each copy clipped to one side of equality,
          so the colour itself says who is ahead. A single tone for both sides
          reads as "White is winning" wherever the shaded mass is large —
          cream is the light pieces' colour — even when the mass hangs below
          the midline because Black is four pawns up.
        */}
        <defs>
          <clipPath id={`${id}-above`}>
            <rect x={0} y={0} width={WIDTH} height={geometry.midline} />
          </clipPath>
          <clipPath id={`${id}-below`}>
            <rect
              x={0}
              y={geometry.midline}
              width={WIDTH}
              height={HEIGHT - geometry.midline}
            />
          </clipPath>
        </defs>

        <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="graph-ground" />
        {/*
          The top half is the reviewer's, so its tone follows the colour they
          played rather than being fixed to White.
        */}
        <path
          d={geometry.areaPath}
          className={`graph-area ${orientation === "black" ? "black" : "white"}`}
          clipPath={`url(#${id}-above)`}
        />
        <path
          d={geometry.areaPath}
          className={`graph-area ${orientation === "black" ? "white" : "black"}`}
          clipPath={`url(#${id}-below)`}
        />
        <line
          x1={0}
          y1={geometry.midline}
          x2={WIDTH}
          y2={geometry.midline}
          className="graph-midline"
        />
        <path d={geometry.linePath} className="graph-line" />

        {/* Turning points, marked so they can be found by eye. */}
        {geometry.points
          .filter(
            (p) =>
              p.isUserMove &&
              (p.classification === "blunder" || p.classification === "mistake"),
          )
          .map((p) => (
            <circle
              key={p.positionIndex}
              cx={p.x}
              cy={p.y}
              r={4}
              className={`graph-mark ${p.classification}`}
            />
          ))}

        {/*
          The legend the colours still need: a reader who has not seen the
          board cannot know which tone is which side.
        */}
        <text x={6} y={12} className="graph-axis-label">
          {orientation === "black" ? "Black" : "White"}
        </text>
        <text x={6} y={HEIGHT - 5} className="graph-axis-label">
          {orientation === "black" ? "White" : "Black"}
        </text>

        {currentPoint && (
          <line
            x1={currentPoint.x}
            y1={0}
            x2={currentPoint.x}
            y2={HEIGHT}
            className="graph-cursor"
          />
        )}

        {/*
          Invisible hit targets: clicking the graph jumps to that move. Sized
          to the real spacing so neighbours overlap slightly — anything
          narrower leaves stripes that swallow a click.
        */}
        {geometry.points.map((p) => {
          const half = hitWidth(geometry.points, WIDTH) / 2;
          return (
            <rect
              key={p.positionIndex}
              x={p.x - half}
              y={0}
              width={half * 2}
              height={HEIGHT}
              className="graph-hit"
              onClick={() => onSelect(p.positionIndex)}
            >
              <title>{`Move ${Math.ceil(p.positionIndex / 2)}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
