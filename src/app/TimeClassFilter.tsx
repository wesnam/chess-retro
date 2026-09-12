import Link from "next/link";

/**
 * Time control is a filter over everything and never an aggregation axis: a
 * blitz time-pressure error and a rapid miscalculation are different problems
 * with different remedies, so no view mixes them.
 */
export function TimeClassFilter({
  available,
  selected,
}: {
  available: { timeClass: string; count: number }[];
  selected: string;
}) {
  if (available.length === 0) return null;

  return (
    <nav className="tc-filter" aria-label="Time control">
      {available.map(({ timeClass, count }) => (
        <Link
          key={timeClass}
          href={`/?tc=${encodeURIComponent(timeClass)}`}
          className={timeClass === selected ? "tc-option selected" : "tc-option"}
          aria-current={timeClass === selected ? "page" : undefined}
        >
          {timeClass}
          <span className="tc-count">{count}</span>
        </Link>
      ))}
    </nav>
  );
}
