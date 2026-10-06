/**
 * 문서 열람 확인의 계약. 열람 판정은 결재 기능이 소유하고, 감사 같은 다른 기능은 합성 루트가 주입한
 * 구현만 호출한다. 열람할 수 없으면 존재도 알리지 않는다(404).
 */
import type { Actor } from "@fmerp/core";
import type { ServiceContext } from "../server/context";

/** 열람자: 구성원 id와 권한 판정용 Actor */
export interface Viewer {
  membershipId: string;
  actor: Actor;
}

export interface DocumentAccess {
  requireView(ctx: ServiceContext, documentId: string, viewer: Viewer): Promise<void>;
}
