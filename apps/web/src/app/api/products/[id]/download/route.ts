import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import { requireOwnedProduct } from "@/lib/studioApi";

// Redirects to a short-lived presigned R2 URL — the file itself never
// passes through the app server.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireOwnedProduct(params.id);
  if ("error" in access) return access.error;

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "PLY" && kind !== "SOG") {
    return NextResponse.json({ error: "kind must be PLY or SOG" }, { status: 400 });
  }

  const asset = await prisma.asset.findFirst({
    where: { productId: params.id, kind },
    orderBy: { createdAt: "desc" },
  });
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const filename = `${access.product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${kind.toLowerCase()}`;
  const url = await getDownloadUrl(asset.storageKey, filename);
  return NextResponse.redirect(url);
}
