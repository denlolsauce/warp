import Link from "next/link";

import { EmbedPanel } from "@/components/marketing/EmbedPanel";
import { SplatViewer } from "@/components/marketing/SplatViewer";
import { embedPoints, stats, steps } from "@/lib/marketing/content";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative px-5 sm:px-7">
        <div className="relative mx-auto max-w-[1220px] overflow-hidden rounded-[18px] border border-warp-line bg-warp-bg">
          {/*
            The pixel-art starfield still needs to be exported from the design
            project to `public/night-sky.png`. Until it is, the `bg-warp-sky`
            base colour and the gradients below carry the hero on their own.
          */}
          <div
            className="absolute inset-x-0 top-0 h-[600px] bg-warp-sky bg-[url('/night-sky.png')] bg-cover bg-bottom bg-no-repeat"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="absolute inset-x-0 top-0 h-[600px] bg-[linear-gradient(to_bottom,rgba(8,10,16,0.45)_0%,rgba(8,10,16,0.1)_45%,rgba(8,10,16,0.35)_82%,#080a10_100%)]" />
          <div className="pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[820px] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(121,220,214,0.18),transparent_70%)] blur-[8px]" />

          <div className="relative px-5 pt-20 text-center sm:px-7 sm:pt-[120px]">
            <h1 className="m-0 text-balance text-[44px] font-bold leading-none tracking-[-0.02em] text-warp-heading sm:text-[64px] lg:text-[88px]">
              Film it once.
              <br />
              Ship it in 3D.
            </h1>
            <p className="mx-auto mt-6 max-w-[620px] text-pretty text-[19px] text-warp-muted">
              WARP turns a two-minute phone video into a photorealistic 3D model &mdash; rotatable,
              zoomable, and small enough to sit on a product page.
            </p>

            <div className="mt-[34px] flex flex-wrap justify-center gap-3">
              <Link
                href="/waitlist"
                className="whitespace-nowrap rounded-[9px] bg-warp-accent px-6 py-[13px] text-base font-medium text-warp-accent-ink hover:bg-warp-accent-hi hover:text-warp-accent-ink"
              >
                Join the waitlist &rarr;
              </Link>
              <Link
                href="/gallery"
                className="whitespace-nowrap rounded-[9px] border border-warp-line-4 bg-[rgba(255,255,255,0.04)] px-6 py-[13px] text-base font-medium text-warp-body hover:bg-[rgba(255,255,255,0.09)] hover:text-warp-body"
              >
                See the gallery
              </Link>
            </div>

            {/* Viewer preview, cropped by the hero's bottom edge */}
            <div className="mx-auto mt-[70px] max-w-[1000px] overflow-hidden rounded-t-[14px] border border-b-0 border-warp-line-3 bg-warp-panel text-left shadow-[0_-1px_90px_rgba(121,220,214,0.09)]">
              <div className="flex h-[46px] items-center gap-[14px] border-b border-warp-line px-4 text-[13px] font-medium text-warp-meta">
                <span className="flex gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full bg-warp-line-4" />
                  <span className="h-[9px] w-[9px] rounded-full bg-warp-line-4" />
                  <span className="h-[9px] w-[9px] rounded-full bg-warp-line-4" />
                </span>
                <span>preview</span>
                <span className="flex-1" />
                <span className="text-warp-accent">live</span>
                <span>8.4 MB</span>
              </div>
              <SplatViewer
                src="/chair_unpruned_upright.sog"
                label="Interactive 3D model of an armchair, captured on a phone in a living room"
                startAzimuth={1.5708}
                startPolar={1.5708}
                startRadius={1.35}
                className="min-h-[400px] h-[400px]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="-mt-px border-y border-warp-line">
        <div className="mx-auto grid max-w-[1220px] grid-cols-2 px-5 sm:px-7 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="border-l border-warp-line px-2 py-[30px]">
              <div className="text-[38px] font-bold leading-none tracking-[-0.03em] text-warp-heading">
                {stat.value}
              </div>
              <div className="mt-[9px] text-[13.5px] text-warp-dim">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pipeline */}
      <section className="mx-auto max-w-[1220px] px-5 pt-[104px] sm:px-7">
        <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-accent">
          The pipeline
        </div>
        <h2 className="mb-0 mt-4 max-w-[680px] text-[36px] font-bold leading-[1.06] tracking-[-0.015em] text-warp-heading lg:text-[52px]">
          Four steps from a shaky clip to a solid object.
        </h2>
        <p className="mt-[18px] max-w-[560px] text-pretty text-[17px] text-warp-muted">
          You handle the first two. WARP handles the rest, and hands you back something you can keep
          working on.
        </p>

        <div className="mt-11 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.num}
              className="flex flex-col gap-[14px] rounded-[13px] border border-warp-line-2 bg-warp-panel px-[22px] pb-[26px] pt-6 hover:border-[rgba(121,220,214,0.4)]"
            >
              <div className="text-[11.5px] font-semibold tracking-[0.14em] text-warp-accent">
                {step.num}
              </div>
              <div className="text-[27px] font-bold leading-[1.15] tracking-[-0.03em] text-warp-heading">
                {step.name}
              </div>
              <div className="text-pretty text-[15px] text-warp-muted">{step.body}</div>
              <div className="mt-auto border-t border-warp-line pt-4 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-warp-meta">
                {step.meta}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Embed */}
      <section className="mx-auto grid max-w-[1220px] grid-cols-1 items-center gap-14 px-5 pt-[104px] sm:px-7 lg:grid-cols-2">
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-amber">
            The embed
          </div>
          <h2 className="mb-0 mt-4 text-[34px] font-bold leading-[1.08] tracking-[-0.015em] text-warp-heading lg:text-[46px]">
            One tag. Any page.
          </h2>

          <div className="mt-[26px] flex flex-col gap-3">
            {embedPoints.map((point) => (
              <div key={point} className="flex items-start gap-[11px] text-base text-warp-strong">
                <span className="mt-2 h-[5px] w-[5px] flex-none rounded-full bg-warp-amber" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>

        <EmbedPanel />
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-[1220px] px-5 pb-[110px] pt-[104px] sm:px-7">
        <div
          className="relative overflow-hidden rounded-2xl border border-warp-line-2 bg-warp-sky bg-[url('/night-sky.png')] bg-cover bg-bottom bg-no-repeat px-5 py-[74px] text-center sm:px-7"
          style={{ imageRendering: "pixelated" }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(8,10,16,0.5),rgba(8,10,16,0.7))]" />
          <div className="relative">
            <h2 className="m-0 text-[34px] font-bold leading-[1.05] tracking-[-0.015em] text-warp-heading lg:text-[52px]">
              Send us two minutes of footage.
            </h2>
            <p className="mx-auto mt-[18px] max-w-[520px] text-[18px] text-warp-muted">
              We&rsquo;ll send back a model. Early access opens in batches of ten.
            </p>
            <Link
              href="/waitlist"
              className="mt-[30px] inline-block rounded-[9px] bg-warp-accent px-[26px] py-[13px] text-base font-medium text-warp-accent-ink hover:bg-warp-accent-hi hover:text-warp-accent-ink"
            >
              Request an invite &rarr;
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
