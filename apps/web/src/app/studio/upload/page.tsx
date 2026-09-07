import { UploadFlow } from "@/components/studio/UploadFlow";

export default function UploadPage() {
  return (
    <div className="px-7 py-6">
      <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-studio-heading">
        New capture
      </h1>
      <p className="mt-1 max-w-[520px] text-[13px] text-studio-muted">
        Upload one video of one product. It goes straight to storage, then the pipeline turns it
        into an interactive 3D model — usually well under two hours.
      </p>
      <div className="mt-6">
        <UploadFlow />
      </div>
    </div>
  );
}
