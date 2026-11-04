import { Suspense } from "react";
import { DashboardLoader } from "@/components/dashboard-loader";
import { DashboardSkeleton } from "@/components/ui";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardLoader />
    </Suspense>
  );
}
