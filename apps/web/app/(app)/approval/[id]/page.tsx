import { DocumentTimeline, PrintButton } from "@fmerp/feature-audit/ui/components/audit-trail";
import { ApprovalDetailPage } from "@/components/approval/approval-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ApprovalDetailPage
      id={id}
      printButton={<PrintButton documentId={id} />}
      timeline={<DocumentTimeline documentId={id} />}
    />
  );
}
