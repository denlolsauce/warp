import { randomBytes } from "node:crypto";
import { Prisma, type JobStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteStorageObject, getSignedObjectUrl } from "@/lib/r2";
import { PIPELINE_QUEUE_KEY, redis } from "@/lib/queue";
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from "@/lib/project-types";
import type { WorkspaceContext } from "@/lib/workspace-session";
import { STAGE_ORDER } from "@/lib/jobStateMachine";

const projectInclude = {
  video: true,
  assets: { orderBy: { createdAt: "desc" } },
  jobs: {
    take: 1,
    orderBy: { createdAt: "desc" },
    include: { stages: { orderBy: { attempt: "desc" } } },
  },
} satisfies Prisma.ProductInclude;

type ProjectRecord = Prisma.ProductGetPayload<{ include: typeof projectInclude }>;

export class ProjectApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function toProjectDto(product: ProjectRecord): Promise<ProjectDto> {
  const sog = product.assets.find((asset) => asset.kind === "SOG");
  const ply = product.assets.find((asset) => asset.kind === "PLY");
  const job = product.jobs[0];
  const latestStages = new Map<JobStage, (typeof job.stages)[number]>();
  if (job) {
    for (const stage of job.stages) {
      if (!latestStages.has(stage.stage)) latestStages.set(stage.stage, stage);
    }
  }

  const [sogUrl, plyUrl] = await Promise.all([
    sog ? getSignedObjectUrl(sog.storageKey) : Promise.resolve(null),
    ply ? getSignedObjectUrl(ply.storageKey) : Promise.resolve(null),
  ]);

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    location: product.location,
    captureProfile: product.captureProfile,
    status: product.status,
    createdAt: product.createdAt.toISOString(),
    shared: product.shareToken !== null,
    shareToken: product.shareToken,
    sogUrl,
    plyUrl,
    sizeBytes: sog?.sizeBytes ?? null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          currentStage: job.currentStage,
          errorMessage: job.errorMessage,
          stages: STAGE_ORDER.map((stage) => {
            const stageRun = latestStages.get(stage);
            return {
              stage,
              status: stageRun?.status ?? "PENDING",
              metrics: jsonObject(stageRun?.metrics ?? null),
            };
          }),
        }
      : null,
  };
}

export async function listWorkspaceProjects(context: WorkspaceContext): Promise<{
  projects: ProjectDto[];
  workspace: { name: string; plan: string };
  mode: "live";
  configured: { storage: boolean; worker: boolean };
}> {
  const products = await prisma.product.findMany({
    where: { orgId: context.org.id },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
  });
  return {
    projects: await Promise.all(products.map(toProjectDto)),
    workspace: { name: context.org.name, plan: context.org.plan },
    mode: "live",
    configured: {
      storage: (await import("@/lib/r2")).isStorageConfigured(),
      worker: Boolean(process.env.WORKER_CALLBACK_SECRET?.trim()),
    },
  };
}

export async function getWorkspaceProject(orgId: string, id: string): Promise<ProjectDto | null> {
  const product = await prisma.product.findFirst({ where: { id, orgId }, include: projectInclude });
  return product ? toProjectDto(product) : null;
}

async function getProjectRecord(orgId: string, id: string): Promise<ProjectRecord | null> {
  return prisma.product.findFirst({ where: { id, orgId }, include: projectInclude });
}

async function enqueueOnce(jobId: string, productId: string): Promise<void> {
  const script = `
    if redis.call("SET", KEYS[1], "1", "NX", "EX", ARGV[2]) then
      redis.call("LPUSH", KEYS[2], ARGV[1])
      return 1
    end
    return 0
  `;
  try {
    await redis.eval(
      script,
      2,
      `${PIPELINE_QUEUE_KEY}:queued:${jobId}`,
      PIPELINE_QUEUE_KEY,
      JSON.stringify({ jobId, productId }),
      String(30 * 24 * 60 * 60),
    );
  } catch {
    throw new ProjectApiError("project was saved but could not be queued; retry the request", 503);
  }
}

export async function createWorkspaceProject(
  context: WorkspaceContext,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const upload = await prisma.uploadSession.findFirst({
    where: {
      uploadId: input.uploadId,
      userId: context.userId,
      ...(input.key ? { storageKey: input.key } : {}),
    },
  });
  if (!upload) throw new ProjectApiError("upload session not found", 404);
  if (upload.status !== "COMPLETED" || upload.completedSizeBytes === null) {
    throw new ProjectApiError("upload must be completed before creating a project", 409);
  }

  let product = await prisma.product.findUnique({
    where: { uploadSessionId: upload.id },
    include: projectInclude,
  });
  if (product) {
    if (product.orgId !== context.org.id) throw new ProjectApiError("project not found", 404);
    const latestJob = product.jobs[0];
    if (latestJob?.status === "QUEUED") await enqueueOnce(latestJob.id, product.id);
    return toProjectDto(product);
  }
  if (upload.consumedAt) throw new ProjectApiError("this upload has already been used", 409);

  try {
    product = await prisma.$transaction(async (tx) => {
      const claim = await tx.uploadSession.updateMany({
        where: { id: upload.id, userId: context.userId, status: "COMPLETED", consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claim.count !== 1) throw new ProjectApiError("this upload has already been used", 409);

      return tx.product.create({
        data: {
          orgId: context.org.id,
          name: input.name,
          description: input.description,
          location: input.location,
          captureProfile: "drone",
          status: "UPLOADED",
          uploadSessionId: upload.id,
          video: { create: { storageKey: upload.storageKey } },
          jobs: {
            create: {
              status: "QUEUED",
            },
          },
        },
        include: projectInclude,
      });
    });
  } catch (error) {
    const concurrentProduct = await prisma.product.findUnique({
      where: { uploadSessionId: upload.id },
      include: projectInclude,
    });
    if (concurrentProduct) {
      if (concurrentProduct.orgId !== context.org.id) throw new ProjectApiError("project not found", 404);
      product = concurrentProduct;
    } else {
      throw error;
    }
  }

  const job = product.jobs[0];
  if (job) await enqueueOnce(job.id, product.id);
  return toProjectDto(product);
}

export async function updateWorkspaceProject(
  orgId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectDto | null> {
  const existing = await prisma.product.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!existing) return null;
  const product = await prisma.product.update({ where: { id }, data: input, include: projectInclude });
  return toProjectDto(product);
}

export async function setProjectShared(
  orgId: string,
  id: string,
  enabled: boolean,
): Promise<{ shared: boolean; shareToken: string | null; sharePath: string | null }> {
  const project = await prisma.product.findFirst({
    where: { id, orgId },
    select: { id: true, status: true, shareToken: true },
  });
  if (!project) throw new ProjectApiError("project not found", 404);
  if (enabled && project.status !== "READY") {
    throw new ProjectApiError("project must be ready before it can be shared", 409);
  }

  if (!enabled) {
    await prisma.product.update({ where: { id }, data: { shareToken: null } });
    return { shared: false, shareToken: null, sharePath: null };
  }

  const shareToken = project.shareToken ?? randomBytes(24).toString("base64url");
  await prisma.product.update({ where: { id }, data: { shareToken } });
  return { shared: true, shareToken, sharePath: `/share/${shareToken}` };
}

export async function getSharedProject(token: string): Promise<ProjectDto | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const product = await prisma.product.findFirst({
    where: { shareToken: token, status: "READY" },
    include: projectInclude,
  });
  return product ? toProjectDto(product) : null;
}

export async function deleteWorkspaceProject(orgId: string, id: string): Promise<boolean> {
  const product = await prisma.product.findFirst({
    where: { id, orgId },
    include: { video: true, assets: true, jobs: { select: { id: true, status: true } } },
  });
  if (!product) return false;
  if (product.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")) {
    throw new ProjectApiError("processing projects cannot be deleted", 409);
  }

  const objectKeys = [...product.assets.map((asset) => asset.storageKey), ...(product.video ? [product.video.storageKey] : [])];
  await prisma.$transaction(async (tx) => {
    const jobIds = product.jobs.map((job) => job.id);
    if (jobIds.length) await tx.jobStageRun.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.job.deleteMany({ where: { productId: id } });
    await tx.asset.deleteMany({ where: { productId: id } });
    await tx.productVideo.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
  });
  await Promise.all(objectKeys.map((key) => deleteStorageObject(key).catch((error) => {
    console.error("failed to delete project storage object", error);
  })));
  return true;
}

export async function regenerateWorkspaceProject(orgId: string, id: string): Promise<ProjectDto> {
  const project = await getProjectRecord(orgId, id);
  if (!project) throw new ProjectApiError("project not found", 404);
  if (!project.jobs.length || project.jobs[0].status === "FAILED" || project.jobs[0].status === "SUCCEEDED") {
    const product = await prisma.$transaction(async (tx) => {
      if (!project.video) throw new ProjectApiError("project has no source video", 409);
      const claimed = await tx.product.updateMany({
        where: { id, orgId, status: { in: ["READY", "FAILED", "UPLOADED"] } },
        data: { status: "PROCESSING" },
      });
      if (claimed.count !== 1) throw new ProjectApiError("a project job is already running", 409);
      const job = await tx.job.create({
        data: {
          productId: id,
          status: "QUEUED",
        },
      });
      return { job };
    });
    await enqueueOnce(product.job.id, id);
    const updatedProject = await getWorkspaceProject(orgId, id);
    if (!updatedProject) throw new ProjectApiError("project not found", 404);
    return updatedProject;
  }

  if (project.jobs[0].status === "QUEUED") {
    await enqueueOnce(project.jobs[0].id, project.id);
    return toProjectDto(project);
  }
  throw new ProjectApiError("a project job is already running", 409);
}
