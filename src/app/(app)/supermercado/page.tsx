import { ReceiptsList } from "@/components/receipts-list";
import { PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Tickets"
        title="Supermercado"
        description="Tickets de este hogar."
      />
      <ReceiptsList readOnly />
    </PageStack>
  );
}
