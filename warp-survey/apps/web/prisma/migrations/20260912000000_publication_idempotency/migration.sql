-- Publication idempotency: a replayed worker callback must reuse the run's
-- revision and skip artifacts it already stored, rather than duplicating them.

-- CreateIndex
CREATE UNIQUE INDEX "SurveyRevision_runId_key" ON "SurveyRevision"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_revisionId_storageKey_key" ON "Artifact"("revisionId", "storageKey");
