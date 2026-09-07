import type { ChangeFinding, ChangeReport } from "@portal/schema";

/**
 * Presentation rules for a survey report.
 *
 * These are here rather than inline in the page because they are the part of
 * the UI that can actually mislead. A change measurement means nothing
 * without its uncertainty, so the formatters below refuse to render one
 * without the other, and the confidence bands are the vocabulary the page
 * uses instead of implying precision the survey does not have.
 */

/**
 * Millimetres below a metre, metres above it. Sub-metre movement is what a
 * monitoring survey is about and "0.038 m" is harder to read at a glance
 * than "38 mm"; above a metre the reverse is true.
 */
export function formatDistance(metres: number): string {
  const magnitude = Math.abs(metres);
  if (magnitude < 1) {
    return `${Math.round(metres * 1000)} mm`;
  }
  return `${metres.toFixed(2)} m`;
}

/**
 * A measurement and its 95% detection threshold, always together. The
 * threshold is what separates "the face has moved 38 mm" from "we cannot
 * tell whether the face has moved".
 */
export function formatDistanceWithTolerance(metres: number, levelOfDetectionM: number): string {
  return `${formatDistance(metres)} ±${formatDistance(levelOfDetectionM)}`;
}

export function formatVolume(cubicMetres: number, uncertaintyM3: number): string {
  const rounded = Math.abs(cubicMetres) < 10 ? cubicMetres.toFixed(2) : cubicMetres.toFixed(1);
  return `${rounded} ±${uncertaintyM3.toFixed(2)} m³`;
}

export type ConfidenceBand = "marginal" | "clear" | "unambiguous";

/**
 * How far past its own detection threshold a finding sits.
 *
 * Deliberately three coarse bands rather than a number: the ratio itself is
 * on the report for anyone who wants it, but the decision a reader is making
 * is "do I trust this enough to walk out there", and a 2.7 vs 3.1 distinction
 * does not change that answer. The thresholds:
 *
 * - below 2x, the finding is within a factor of two of the noise floor and a
 *   re-fly would be a reasonable response before acting on it;
 * - 2-5x is a real measurement;
 * - above 5x, the movement is far larger than anything the survey's own
 *   precision could account for.
 */
export function confidenceBand(finding: ChangeFinding): ConfidenceBand {
  if (finding.peakConfidenceRatio < 2) return "marginal";
  if (finding.peakConfidenceRatio < 5) return "clear";
  return "unambiguous";
}

export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = {
  marginal: "Near detection limit",
  clear: "Measured",
  unambiguous: "Well above detection limit",
};

/**
 * Reasons a report should not be read at face value.
 *
 * Returned as a list to show above the findings rather than being folded
 * into them: a reader has to be able to see that a survey is unreliable
 * before they read what it claims, not after.
 */
export function surveyCaveats(report: ChangeReport): string[] {
  const caveats: string[] = [];

  if (!report.precision.registrationConverged) {
    caveats.push(
      "The captures could not be finely aligned within the iteration limit. Every distance below " +
        "is measured against an alignment that was still moving, so treat the level of detection " +
        "as a lower bound.",
    );
  }

  // Coverage below this and the survey has holes rather than findings — the
  // measured areas may be fine, but "nothing else moved" is not supportable.
  if (report.change.measuredFraction < 0.8) {
    caveats.push(
      `Only ${Math.round(report.change.measuredFraction * 100)}% of the site had usable surface in ` +
        "both captures. Unmeasured ground is not evidence of stability — consider re-flying the " +
        "gaps before signing off.",
    );
  }

  if (report.siteVolume.excludedSteepAreaM2 > 0) {
    caveats.push(
      `${report.siteVolume.excludedSteepAreaM2.toFixed(1)} m² of near-vertical face is too steep ` +
        "to integrate, so the volumes exclude it. The distances measured there are still valid.",
    );
  }

  const worstControlRmse = Math.max(
    report.precision.baselineControlRmseM,
    report.precision.repeatControlRmseM,
  );
  // A GCP fit this loose means the site grid itself is uncertain at that
  // scale. Change detection survives it (both captures are aligned onto each
  // other, so a shared offset cancels), but absolute positions do not.
  if (worstControlRmse > 0.05) {
    caveats.push(
      `Ground control residuals reach ${formatDistance(worstControlRmse)}. Change between the two ` +
        "captures is unaffected, but the absolute site coordinates carry that error.",
    );
  }

  return caveats;
}
