import { Workspace } from "@/components/workspace/Workspace";
export default function Page({ params }: { params: { id: string } }) {
  return <Workspace projectId={params.id}/>;
}
