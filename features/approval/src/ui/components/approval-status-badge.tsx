import { StatusBadge } from "@fmerp/shared/ui/status-badge";

export type ApprovalStatusBadgeProps = {
  status: string;
  className?: string;
};

/** 결재 문서 상태 배지. shared StatusBadge에 kind="document"를 고정해 전달한다. */
export function ApprovalStatusBadge({ status, className }: ApprovalStatusBadgeProps) {
  return <StatusBadge kind="document" status={status} className={className} />;
}
