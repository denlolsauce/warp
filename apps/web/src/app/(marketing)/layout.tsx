import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-warp-bg text-warp-body">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
