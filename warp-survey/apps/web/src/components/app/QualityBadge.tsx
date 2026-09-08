export function QualityBadge({ state }: { state: string }) {
  const label = state === "PASS" || state === "FAIL" ? state : "UNVERIFIED";
  const styles = {
    PASS: "border-survey-mineral/30 bg-survey-mineral-soft text-survey-mineral",
    FAIL: "border-survey-danger/30 bg-red-50 text-survey-danger",
    UNVERIFIED: "border-survey-amber/30 bg-amber-50 text-survey-amber",
  };
  return <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-xs font-medium ${styles[label]}`}>{label}</span>;
}
