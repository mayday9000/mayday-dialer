import { PageHeader } from "@/components/page-header";

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col">
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center p-16 text-sm text-muted-foreground">
        Coming soon.
      </div>
    </div>
  );
}
