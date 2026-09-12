"use client";

import { useMemo } from "react";
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
  onSelect,
}: {
  points: ReviewGraphPoint[];
  current: number;
  lastPositionIndex: number;
  onSelect: (positionIndex: number) => void;
}) {
  const geometry = useMemo(
    () =>
      graphGeometry({
        points,
        width: WIDTH,
        height: HEIGHT,
        lastPositionIndex,
      }),
    [points, lastPositionIndex],
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
        {/* Black's half, so the shaded area reads against a dark ground. */}
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="graph-ground" />
        <path d={geometry.areaPath} className="graph-area" />
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
