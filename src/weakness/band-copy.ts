import { REFERENCE_BAND, type ReferenceFit } from "./band";

/**
 * What to tell someone the reference cohort does not describe.
 *
 * The ranking compares this player's miss rates against real games from a
 * narrow cohort, and outside that cohort the comparison is not merely
 * approximate — it is wrong in a knowable direction. A stronger player beats
 * the cohort on every tactic, so every excess goes negative and the dashboard
 * would report, with no visible hesitation, that they have no weaknesses.
 *
 * Saying which way it is wrong matters more than saying that it is: "ranked
 * against weaker players, so this understates you" is something a reader can
 * correct for, while a bare "may be inaccurate" is not.
 */

const BAND = `${REFERENCE_BAND.min}-${REFERENCE_BAND.max}`;

export function fitCaveat(
  fit: ReferenceFit,
  rating: number | undefined,
): string | undefined {
  switch (fit.reason) {
    case "in-band":
      return undefined;

    case "above-band":
      return (
        `Your ${REFERENCE_BAND.timeClass} rating is around ${rating}, but these rankings compare you ` +
        `against players rated ${BAND}. You are stronger than that cohort, so this understates ` +
        `your weaknesses — you will beat their rate on almost everything, and the gaps between ` +
        `your own tactics matter more here than the comparison does.`
      );

    case "below-band":
      return (
        `Your ${REFERENCE_BAND.timeClass} rating is around ${rating}, but these rankings compare you ` +
        `against players rated ${BAND}. You are weaker than that cohort, so this overstates your ` +
        `weaknesses — missing more than they do is expected at your rating, and the order of the ` +
        `list is more useful to you than the size of each gap.`
      );

    case "other-time-class":
      return (
        `These rankings compare you against a cohort measured on ${REFERENCE_BAND.timeClass} games ` +
        `rated ${BAND}. This is a different time control, where blunder rates differ, so treat the ` +
        `comparison as rough and the ordering as the useful part.`
      );

    case "unknown-rating":
      return (
        `No rating was recorded on your games, so there is no way to tell whether the reference ` +
        `cohort — players rated ${BAND} at ${REFERENCE_BAND.timeClass} — is a fair comparison for you. ` +
        `If you are far from that range, the size of each gap will be off.`
      );
  }
}
