"use client";

import { useState } from "react";

import { volumeOptions } from "@/lib/marketing/content";

import { chipClasses } from "./chip";

const fieldClasses =
  "rounded-[9px] border border-warp-line-3 bg-warp-well px-[14px] py-3 text-[15px] text-warp-body placeholder:text-warp-faint";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [volume, setVolume] = useState("10-50");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, volume, notes }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        // Only confirm once it is actually stored: a success screen over a
        // failed write loses the signup silently, which is the one outcome
        // this form must not produce.
        setError(detail?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setSubmitted(false);
    setError(null);
    setEmail("");
    setCompany("");
    setNotes("");
  }

  if (submitted) {
    return (
      <div className="rounded-[14px] border border-warp-line-2 bg-warp-panel px-[30px] pb-[34px] pt-8">
        <div className="px-1 py-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-warp-accent">
            <div className="h-[14px] w-[14px] rounded-full bg-warp-accent" />
          </div>
          <h2 className="mb-0 mt-[22px] text-[34px] font-bold tracking-[-0.03em] text-warp-heading">
            You&rsquo;re on the list.
          </h2>
          <p className="mt-3 text-[16.5px] text-warp-muted">
            We&rsquo;ll write to {email} with a capture guide and your batch number within two
            working days.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-[26px] text-[14.5px] text-warp-accent hover:text-warp-accent-hi"
          >
            Add another team
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[14px] border border-warp-line-2 bg-warp-panel px-[30px] pb-[34px] pt-8"
    >
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-warp-faint">
        Request access
      </div>

      <div className="mt-[22px] flex flex-col gap-[18px]">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-warp-strong">Work email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className={fieldClasses}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-warp-strong">Company</span>
          <input
            type="text"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Studio, brand or retailer"
            className={fieldClasses}
          />
        </label>

        <fieldset className="flex flex-col gap-[9px] border-0 p-0">
          <legend className="text-sm text-warp-strong">
            Objects you&rsquo;d capture in month one
          </legend>
          <div className="flex gap-2">
            {volumeOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setVolume(option)}
                aria-pressed={volume === option}
                className={`flex-1 rounded-lg border px-1 py-2.5 text-center text-sm font-semibold ${chipClasses(
                  volume === option,
                )}`}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-warp-strong">What are you selling?</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ceramics, furniture, sneakers, instruments…"
            className={`${fieldClasses} resize-y`}
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-[9px] bg-warp-accent p-[14px] text-center text-base font-medium text-warp-accent-ink hover:bg-warp-accent-hi disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Sending…" : "Request access"}
        </button>

        {error && (
          <div role="alert" className="text-center text-[13px] text-warp-amber">
            {error}
          </div>
        )}

        <div className="text-center text-[13px] text-warp-faint">
          No newsletter. One email when your batch opens.
        </div>
      </div>
    </form>
  );
}
