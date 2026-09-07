import type { ChangeFinding, ChangeReport, VolumeEstimate } from "@portal/schema";

import {
  CONFIDENCE_BAND_LABEL,
  confidenceBand,
  formatDistance,
  formatDistanceWithTolerance,
  formatVolume,
  surveyCaveats,
} from "@/lib/survey/format";

/**
 * Renders one change report from the pipeline's `monitor` stage.
 *
 * Reading order is the argument this component makes: precision and caveats
 * come before findings, because a reader has to be able to judge whether to
 * trust the numbers before they read them. Every measurement is shown with
 * its own tolerance, and no view here aggregates a "site risk" — that
 * judgement is the engineer's, and the report deliberately does not have the
 * inputs for it.
 */

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[10px] border border-warp-line-2 bg-warp-well px-4 py-3.5">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
        {label}
      </div>
      <div className="mt-2 font-mono text-[20px] leading-none text-warp-heading">{value}</div>
      {detail && <div className="mt-2 text-[13px] leading-snug text-warp-faint">{detail}</div>}
    </div>
  );
}

const DIRECTION_LABEL = { loss: "Material lost", gain: "Material gained" } as const;

function VolumeLine({ volume, direction }: { volume: VolumeEstimate; direction: "loss" | "gain" }) {
  const magnitude = direction === "loss" ? volume.lossM3 : volume.gainM3;
  return (
    <>
      <span className="font-mono text-warp-body">{formatVolume(magnitude, volume.uncertaintyM3)}</span>
      <span className="text-warp-faint"> over {volume.surfaceAreaM2.toFixed(1)} m²</span>
    </>
  );
}

function Finding({ finding }: { finding: ChangeFinding }) {
  const band = confidenceBand(finding);
  return (
    <li className="border-t border-warp-line px-5 py-5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[13px] text-warp-faint">
            {String(finding.clusterId + 1).padStart(2, "0")}
          </span>
          <span className="text-[16.5px] font-medium text-warp-title">
            {DIRECTION_LABEL[finding.direction]}
          </span>
        </div>
        {/* The band, not the raw ratio: what a reader decides from this is
            whether to act, and the exact multiple does not change that. */}
        <span
          className={
            band === "marginal"
              ? "rounded-full border border-warp-line-3 px-2.5 py-1 text-[12px] text-warp-amber"
              : "rounded-full border border-warp-line-3 px-2.5 py-1 text-[12px] text-warp-meta"
          }
        >
          {CONFIDENCE_BAND_LABEL[band]} · {finding.peakConfidenceRatio.toFixed(1)}× LoD
        </span>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-warp-meta">Peak movement</dt>
          <dd className="mt-1 font-mono text-[15px] text-warp-body">
            {formatDistanceWithTolerance(finding.peakDistanceM, finding.peakLevelOfDetectionM)}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-warp-meta">Volume</dt>
          <dd className="mt-1 text-[15px]">
            <VolumeLine volume={finding.volume} direction={finding.direction} />
          </dd>
        </div>
        <div>
          <dt className="text-[12px] uppercase tracking-[0.08em] text-warp-meta">Location</dt>
          <dd className="mt-1 font-mono text-[14px] text-warp-muted">
            {finding.centroid[0].toFixed(1)}, {finding.centroid[1].toFixed(1)},{" "}
            {finding.centroid[2].toFixed(1)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function SurveyReportView({ report }: { report: ChangeReport }) {
  const caveats = surveyCaveats(report);
  const { change, precision, siteVolume } = report;

  return (
    <article>
      <header>
        <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-accent">
          Change survey
        </div>
        <h1 className="mt-3 text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-warp-heading sm:text-[42px]">
          {report.baseline} &rarr; {report.repeat}
        </h1>
        <p className="mt-4 max-w-[62ch] text-[16.5px] text-warp-muted">
          {change.corePoints.toLocaleString("en-GB")} points compared by{" "}
          {report.method.changeDetection}. Movement smaller than the level of detection is reported
          as no resolvable change, not as a small number.
        </p>
      </header>

      {caveats.length > 0 && (
        // Above the findings on purpose. A caveat discovered after reading
        // the numbers has already failed at its job.
        <section className="mt-8 rounded-[12px] border border-warp-line-3 bg-warp-panel px-5 py-4">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-amber">
            Read first
          </h2>
          <ul className="mt-3 space-y-2.5">
            {caveats.map((caveat) => (
              <li key={caveat} className="text-[14.5px] leading-relaxed text-warp-strong">
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-9">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
          Survey precision
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Level of detection"
            value={
              change.medianLevelOfDetectionM === null
                ? "—"
                : formatDistance(change.medianLevelOfDetectionM)
            }
            detail={`Median, at ${Math.round(change.confidenceLevel * 100)}% confidence. Nothing smaller is resolvable.`}
          />
          <Metric
            label="Alignment error"
            value={formatDistance(precision.registrationRmseM)}
            detail={
              precision.registrationConverged
                ? `Converged on ${precision.registrationInlierCount.toLocaleString("en-GB")} stable points.`
                : "Did not converge — see the note above."
            }
          />
          <Metric
            label="Coverage"
            value={`${Math.round(change.measuredFraction * 100)}%`}
            detail="Of the site with usable surface in both captures."
          />
          <Metric
            label="Point spacing"
            value={formatDistance(report.method.pointSpacingM)}
            detail="Capture resolution; every search radius derives from it."
          />
        </div>
      </section>

      <section className="mt-9">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
          Site totals
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {/* Loss and gain before net: material off a crest and the same
              volume at the toe nets to zero, and that is a developing
              failure rather than an absence of change. */}
          <Metric
            label="Lost"
            value={formatVolume(siteVolume.lossM3, siteVolume.uncertaintyM3)}
            detail={change.maxLossM === null ? undefined : `Deepest ${formatDistance(change.maxLossM)}.`}
          />
          <Metric
            label="Gained"
            value={formatVolume(siteVolume.gainM3, siteVolume.uncertaintyM3)}
            detail={change.maxGainM === null ? undefined : `Highest ${formatDistance(change.maxGainM)}.`}
          />
          <Metric
            label="Net"
            value={formatVolume(siteVolume.netM3, siteVolume.uncertaintyM3)}
            detail={`Across ${siteVolume.surfaceAreaM2.toFixed(0)} m² of changed surface.`}
          />
        </div>
      </section>

      <section className="mt-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
            Inspection queue
          </h2>
          <p className="text-[13.5px] text-warp-faint">
            Ranked by measured movement, largest first
          </p>
        </div>

        {report.findings.length === 0 ? (
          <p className="mt-4 rounded-[12px] border border-warp-line-2 bg-warp-panel px-5 py-8 text-center text-[15px] text-warp-muted">
            No movement above the level of detection.
            {change.medianLevelOfDetectionM !== null && (
              <>
                {" "}
                This survey could resolve{" "}
                <span className="font-mono text-warp-body">
                  {formatDistance(change.medianLevelOfDetectionM)}
                </span>
                , so the site is stable to that precision — not to any finer one.
              </>
            )}
          </p>
        ) : (
          <ol className="mt-4 rounded-[12px] border border-warp-line-2 bg-warp-panel">
            {report.findings.map((finding) => (
              <Finding key={finding.clusterId} finding={finding} />
            ))}
          </ol>
        )}
      </section>

      <footer className="mt-9 border-t border-warp-line pt-5 text-[13px] leading-relaxed text-warp-faint">
        Georeferenced by {report.method.georeferencing}; aligned by {report.method.fineAlignment}.
        Ground control residuals {formatDistance(precision.baselineControlRmseM)} (baseline) and{" "}
        {formatDistance(precision.repeatControlRmseM)} (repeat). This report presents measurements
        and their uncertainties only; interpretation and sign-off rest with the reviewing engineer.
      </footer>
    </article>
  );
}
