/** 관리 콘솔 진입 경로: 쓸 수 있는 첫 메뉴. 하나도 없으면 null (실제 권한은 서버가 판정한다) */
export function adminEntry(caps: Record<string, boolean> | undefined): string | null {
  if (!caps) return null;
  if (caps["account.settings"]) return "/admin/settings";
  if (caps["business.create"]) return "/admin/businesses";
  if (caps["department.edit"]) return "/admin/org";
  if (caps["member.invite"] || caps["member.deactivate"] || caps["assignment.manage"]) {
    return "/admin/members";
  }
  if (caps["position.manage"]) return "/admin/positions";
  return null;
}
