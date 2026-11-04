import { Suspense } from "react";
import { ReceiptsList } from "@/components/receipts-list";
import { SectionNav } from "@/components/section-nav";
import { PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PageStack>
        <PageHeader title="Supermercado" description="Los tickets de este hogar." />
        <SectionNav section="hogar" />
        <ReceiptsList readOnly />
      </PageStack>
    </Suspense>
  );
}
