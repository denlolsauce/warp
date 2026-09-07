import type { ProductStatus } from "@prisma/client";

const STYLES: Record<ProductStatus, { label: string; classes: string; dot: string }> = {
  DRAFT: { label: "Draft", classes: "bg-[rgba(28,26,23,0.05)] text-studio-muted border-studio-line", dot: "bg-studio-faint" },
  UPLOADED: { label: "Uploaded", classes: "bg-[rgba(28,26,23,0.05)] text-studio-muted border-studio-line", dot: "bg-studio-faint" },
  PROCESSING: { label: "Processing", classes: "bg-studio-amber-bg text-studio-amber border-studio-amber-line", dot: "bg-studio-amber" },
  READY: { label: "Ready", classes: "bg-studio-green-bg text-studio-green border-[rgba(63,125,78,0.25)]", dot: "bg-studio-green" },
  FAILED: { label: "Failed", classes: "bg-studio-red-bg text-studio-red border-[rgba(179,64,42,0.25)]", dot: "bg-studio-red" },
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px] font-medium ${s.classes}`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
