"use client";

import { useState } from "react";

import {
  GALLERY_COLUMNS,
  galleryCategories,
  galleryItems,
} from "@/lib/marketing/content";

import { chipClasses } from "./chip";
import { SplatViewer } from "./SplatViewer";

export function GalleryBrowser() {
  const [filter, setFilter] = useState(galleryCategories[0]);

  const visible =
    filter === "All" ? galleryItems : galleryItems.filter((item) => item.category === filter);

  return (
    <>
      <div className="mx-auto mt-9 flex max-w-[1220px] flex-wrap gap-[9px] px-5 sm:px-7">
        {galleryCategories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setFilter(category)}
            aria-pressed={filter === category}
            className={`rounded-full border px-[15px] py-2 text-[13.5px] ${chipClasses(
              filter === category,
            )}`}
          >
            {category}
          </button>
        ))}
      </div>

      <section className="mx-auto max-w-[1220px] px-5 pt-8 sm:px-7">
        <div
          className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-[repeat(var(--gallery-cols),minmax(0,1fr))]"
          style={{ "--gallery-cols": GALLERY_COLUMNS } as React.CSSProperties}
        >
          {visible.map((item) => (
            <article
              key={item.name}
              className="cursor-pointer overflow-hidden rounded-[13px] border border-warp-line-2 bg-warp-panel hover:border-[rgba(121,220,214,0.45)]"
            >
              <div className="relative flex aspect-[4/3] items-center justify-center bg-warp-well bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.035)_0_2px,transparent_2px_11px)]">
                {item.model ? (
                  <SplatViewer
                    src={item.model}
                    label={`Interactive 3D model of the ${item.name.toLowerCase()}`}
                    startRadius={item.startRadius}
                    // h-full, not absolute inset-0: the viewer's own wrapper is
                    // `relative` so the loading overlay can sit on top of it,
                    // and a second position utility just collides with that.
                    // The card supplies the 4:3 box, this fills it.
                    className="h-full w-full"
                  />
                ) : (
                  <div className="px-5 text-center text-[11.5px] font-semibold uppercase tracking-[0.1em] text-warp-faint">
                    {item.slot}
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full border border-warp-line-3 bg-warp-bg/70 px-[9px] py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-warp-strong">
                  {item.category}
                </span>
              </div>
              <div className="px-[17px] pb-[18px] pt-4">
                <div className="flex items-baseline gap-2.5">
                  <div className="flex-1 text-[16.5px] text-warp-title">{item.name}</div>
                  <div className="text-[13px] font-semibold text-warp-accent">{item.size}</div>
                </div>
                <div className="mt-3 flex gap-[18px] text-[11.5px] font-semibold text-warp-meta">
                  <span>{item.clip} clip</span>
                  <span>{item.gaussians}</span>
                  <span>{item.build}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
