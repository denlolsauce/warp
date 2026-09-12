import Link from "next/link";
import {
  hero,
  problem,
  howItWorks,
  twoOutputs,
  useCases,
  trust,
  pricing,
  finalCta,
  sampleDataDisclosure,
} from "@/lib/marketing/content";

function SectionHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-2xl font-semibold tracking-tight text-survey-heading md:text-3xl">
      {children}
    </h2>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-survey-line bg-survey-card">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="font-mono text-xs uppercase tracking-widest text-survey-mineral">
            Repeat drone surveys · change detection · engineering documentation
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-survey-heading md:text-5xl">
            {hero.headline}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-survey-muted">{hero.subheadline}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href={hero.primaryCta.href}
              className="rounded border border-survey-slate bg-survey-slate px-6 py-3 text-sm font-medium text-white hover:bg-survey-slate-deep"
            >
              {hero.primaryCta.label}
            </Link>
            <Link
              href={hero.secondaryCta.href}
              className="rounded border border-survey-line-strong px-6 py-3 text-sm font-medium text-survey-heading hover:border-survey-slate"
            >
              {hero.secondaryCta.label}
            </Link>
          </div>
          {/* Illustrative terrain panel — labeled sample; the example splat
              loads only after interaction so the viewer never blocks LCP. */}
          <figure className="mt-14 overflow-hidden rounded border border-survey-line">
            <div className="relative aspect-[21/9] bg-survey-well">
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 840 360"
                preserveAspectRatio="none"
                role="img"
                aria-label="Illustrative contour rendering of a surveyed slope"
              >
                {Array.from({ length: 14 }).map((_, i) => (
                  <path
                    key={i}
                    d={`M0 ${300 - i * 18} C 210 ${280 - i * 20}, 420 ${330 - i * 17}, 630 ${290 - i * 19} S 840 ${300 - i * 18}, 840 ${295 - i * 18}`}
                    fill="none"
                    stroke={i % 5 === 4 ? "#46618c" : "#cfccc4"}
                    strokeWidth={i % 5 === 4 ? 1.5 : 1}
                  />
                ))}
                <g fontFamily="monospace" fontSize="11" fill="#6b7078">
                  <text x="24" y="40">DSM · EPSG:25832 · metre</text>
                  <text x="24" y="58">checkpoints: independent · withheld from optimization</text>
                </g>
              </svg>
            </div>
            <figcaption className="border-t border-survey-line bg-survey-card px-4 py-2 text-xs text-survey-faint">
              {sampleDataDisclosure}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading>{problem.title}</SectionHeading>
        <div className="mt-8 flex flex-wrap items-center gap-2 font-mono text-sm text-survey-muted">
          {problem.flow.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded border border-survey-line-strong bg-survey-card px-3 py-2">{step}</span>
              {i < problem.flow.length - 1 && <span aria-hidden>→</span>}
            </span>
          ))}
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {problem.pains.map((pain) => (
            <li key={pain} className="rounded border border-survey-line bg-survey-card p-4 text-sm leading-relaxed text-survey-body">
              {pain}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="border-y border-survey-line bg-survey-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading id="how-it-works">{howItWorks.title}</SectionHeading>
          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {howItWorks.steps.map((step, i) => (
              <li key={step.title} className="rounded border border-survey-line bg-survey-paper p-6">
                <span className="font-mono text-sm text-survey-mineral">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-medium text-survey-heading">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-survey-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Two linked outputs */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading>{twoOutputs.title}</SectionHeading>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {[twoOutputs.engineers, twoOutputs.stakeholders].map((col) => (
            <div key={col.title} className="rounded border border-survey-line bg-survey-card p-8">
              <h3 className="font-mono text-sm uppercase tracking-widest text-survey-slate">{col.title}</h3>
              <ul className="mt-5 space-y-3">
                {col.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-survey-body">
                    <span aria-hidden className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-survey-mineral" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 rounded border border-survey-line bg-survey-mineral-soft p-4 text-sm leading-relaxed text-survey-body">
          {twoOutputs.clarifier}
        </p>
      </section>

      {/* Use cases */}
      <section className="border-y border-survey-line bg-survey-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading id="use-cases">{useCases.title}</SectionHeading>
          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {useCases.items.map((item) => (
              <li key={item.title} className="rounded border border-survey-line bg-survey-paper p-6">
                <h3 className="font-medium text-survey-heading">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-survey-muted">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-survey-muted">{useCases.disclaimer}</p>
        </div>
      </section>

      {/* Trust and methodology */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading id="methodology">{trust.title}</SectionHeading>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {trust.items.map((item) => (
            <div key={item.title} className="rounded border border-survey-line bg-survey-card p-6">
              <h3 className="font-medium text-survey-heading">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-survey-muted">{item.body}</p>
            </div>
          ))}
        </div>
        <blockquote className="mt-8 rounded border-l-4 border-survey-slate bg-survey-card p-6 text-sm leading-relaxed text-survey-body">
          {trust.accuracyClaim.text}
        </blockquote>
        <p className="mt-4 rounded border border-survey-line bg-survey-mineral-soft p-4 text-sm font-medium leading-relaxed text-survey-body">
          {trust.scopeStatement}
        </p>
      </section>

      {/* Pricing */}
      <section className="border-y border-survey-line bg-survey-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeading id="pricing">{pricing.title}</SectionHeading>
          <p className="mt-4 max-w-2xl text-survey-muted">{pricing.body}</p>
          <Link
            href={pricing.cta.href}
            className="mt-6 inline-block rounded border border-survey-line-strong px-6 py-3 text-sm font-medium text-survey-heading hover:border-survey-slate"
          >
            {pricing.cta.label}
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-survey-heading">
          {finalCta.headline}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-survey-muted">{finalCta.body}</p>
        <Link
          href={finalCta.cta.href}
          className="mt-8 inline-block rounded border border-survey-slate bg-survey-slate px-8 py-3 text-sm font-medium text-white hover:bg-survey-slate-deep"
        >
          {finalCta.cta.label}
        </Link>
      </section>
    </>
  );
}
