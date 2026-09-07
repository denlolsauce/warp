import { readFile } from "node:fs/promises";
import path from "node:path";

import { ChangeReportSchema, type ChangeReport } from "@portal/schema";

/**
 * Loading a survey report from disk.
 *
 * Reports are files rather than database rows for now: the `monitor` stage
 * writes one JSON document per comparison, and there is no schema for
 * sites or capture history yet to hang them off. This keeps the report
 * surface honest about that — when the data model grows a Survey table,
 * only this module changes.
 *
 * Every report is parsed through ChangeReportSchema rather than cast. The
 * producer is a separate Python process across a language boundary that no
 * type system spans, so validation here is the only thing standing between
 * a renamed field upstream and a page silently rendering `undefined` where
 * a level of detection should be.
 */

/**
 * Reports checked into the repo for development and demos, keyed by the id
 * that appears in the URL. Kept as an explicit allowlist rather than
 * resolving the id into a path: an id from the request that reaches
 * path.join is a directory-traversal read of the server's filesystem.
 */
export const SURVEY_FIXTURES: Record<string, string> = {
  "demo-slope": "demo-slope-change-report.json",
};

const FIXTURE_DIR = path.join(process.cwd(), "src", "lib", "survey", "fixtures");

export async function loadSurveyReport(id: string): Promise<ChangeReport | null> {
  const filename = SURVEY_FIXTURES[id];
  if (!filename) {
    return null;
  }

  const raw = await readFile(path.join(FIXTURE_DIR, filename), "utf8");
  // Throws rather than returning null on a malformed document: a missing
  // report is a 404, but a report that exists and does not match the
  // contract is a bug worth surfacing, not an empty page.
  return ChangeReportSchema.parse(JSON.parse(raw));
}
