import { Workspace } from "@/components/workspace/Workspace";
export default function Page({ searchParams }: { searchParams: { view?: string } }) {
  return <Workspace initialView={searchParams.view} />;
}
