import type { Metadata } from "next";
import Link from "next/link";

import { GalleryBrowser } from "@/components/marketing/GalleryBrowser";

export const metadata: Metadata = {
  title: "Gallery — WARP",
  description: "Every one of these started as a phone video.",
};

export default function GalleryPage() {
  return (
    <div>
      <section className="mx-auto max-w-[1220px] px-5 pt-[86px] sm:px-7">
        <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-warp-accent">
          Gallery
        </div>
        <h1 className="mb-0 mt-4 max-w-[760px] text-[40px] font-bold leading-[1.03] tracking-[-0.02em] text-warp-heading sm:text-[52px] lg:text-[66px]">
          Every one of these started as a phone video.
        </h1>
        <p className="mt-5 max-w-[600px] text-pretty text-[18px] text-warp-muted">
          Shot handheld, unedited, in ordinary light. No rigs, no turntables, no retouching between
          the clip and the model.
        </p>
      </section>

      <GalleryBrowser />

      <section className="mx-auto max-w-[1220px] px-5 pb-[110px] pt-[76px] sm:px-7">
        <div className="flex flex-wrap items-center gap-[34px] rounded-[14px] border border-warp-line-2 bg-warp-panel px-[34px] py-[38px]">
          <div className="min-w-[280px] flex-1">
            <h2 className="m-0 text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-warp-heading">
              Want your catalogue in here?
            </h2>
            <p className="mt-3 text-[16.5px] text-warp-muted">
              We take on a handful of catalogues per batch and shoot the first three objects with
              you.
            </p>
          </div>
          <Link
            href="/waitlist"
            className="whitespace-nowrap rounded-[9px] bg-warp-accent px-6 py-[13px] text-base font-medium text-warp-accent-ink hover:bg-warp-accent-hi hover:text-warp-accent-ink"
          >
            Join the waitlist &rarr;
          </Link>
        </div>
      </section>
    </div>
  );
}
