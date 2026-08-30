import type { Metadata } from "next";

import { WaitlistForm } from "@/components/marketing/WaitlistForm";
import { waitlistSteps } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Waitlist — WARP",
  description: "Ten seats open at a time. We onboard early teams in small batches.",
};

export default function WaitlistPage() {
  return (
    <section className="mx-auto grid max-w-[1220px] grid-cols-1 items-start gap-14 px-5 pb-[110px] pt-[86px] sm:px-7 lg:grid-cols-[0.95fr_1fr] lg:gap-[70px]">
      <div>
        <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-accent">
          Waitlist
        </div>
        <h1 className="mb-0 mt-4 text-[40px] font-bold leading-[1.03] tracking-[-0.02em] text-warp-heading lg:text-[60px]">
          Ten seats open at a time.
        </h1>
        <p className="mt-5 text-pretty text-[18px] text-warp-muted">
          We onboard in small batches so every early team gets a real look at their first captures
          with us. Tell us what you make and we&rsquo;ll tell you which batch you&rsquo;re in.
        </p>

        <div className="mt-[38px] flex flex-col gap-px overflow-hidden rounded-xl border border-warp-line-2">
          {waitlistSteps.map((step) => (
            <div key={step.num} className="flex gap-4 bg-warp-panel px-[22px] py-5">
              <div className="pt-[3px] text-[13px] font-bold text-warp-accent">{step.num}</div>
              <div>
                <div className="text-[16.5px] text-warp-title">{step.title}</div>
                <div className="mt-[5px] text-[14.5px] text-warp-dim">{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <WaitlistForm />
    </section>
  );
}
