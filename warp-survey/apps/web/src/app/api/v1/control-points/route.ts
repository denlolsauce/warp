import { controlPointImport } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { authzErrorResponse, requireSurveyAccess } from "@/lib/authz";

// GCPs participate in reconstruction optimization; CHECKPOINT observations
// are withheld from optimization and used only for independent QA. The
// pipeline enforces this split from the role recorded here.
export async function POST(request: Request) {
  try {
    const parsed = controlPointImport.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { surveyId, role, points } = parsed.data;
    const ctx = await requireSurveyAccess(surveyId, "ENGINEER");
    if (ctx.survey.status !== "DRAFT" && ctx.survey.status !== "UPLOADING") {
      return Response.json({ error: "Survey inputs are immutable once processing starts." }, { status: 409 });
    }

    await prisma.$transaction(
      points.map((p) =>
        prisma.controlPoint.upsert({
          where: { surveyId_role_label: { surveyId, role, label: p.label } },
          create: {
            surveyId,
            role,
            label: p.label,
            easting: p.easting,
            northing: p.northing,
            elevation: p.elevation,
            horizontalAccuracyM: p.horizontalAccuracyM,
            verticalAccuracyM: p.verticalAccuracyM,
          },
          update: {
            easting: p.easting,
            northing: p.northing,
            elevation: p.elevation,
            horizontalAccuracyM: p.horizontalAccuracyM,
            verticalAccuracyM: p.verticalAccuracyM,
          },
        }),
      ),
    );
    return Response.json({ imported: points.length }, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error) ?? Response.json({ error: "Internal error" }, { status: 500 });
  }
}
