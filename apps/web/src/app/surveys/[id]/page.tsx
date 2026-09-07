import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SurveyReportView } from "@/components/survey/SurveyReportView";
import { loadSurveyReport, SURVEY_FIXTURES } from "@/lib/survey/reports";

export const metadata: Metadata = {
  title: "Change survey — WARP",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return Object.keys(SURVEY_FIXTURES).map((id) => ({ id }));
}

export default async function SurveyPage({ params }: { params: { id: string } }) {
  const report = await loadSurveyReport(params.id);
  if (!report) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1000px] px-5 py-16 sm:px-7">
      <SurveyReportView report={report} />
    </main>
  );
}
