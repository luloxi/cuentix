import { AdminPanel } from "@/components/admin-panel";
import { PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <PageStack>
      <PageHeader
        title="Administración"
        description="Quién puede entrar. La lista es de solo lectura."
      />
      <AdminPanel readOnly />
    </PageStack>
  );
}
