// 진행 중인 결재가 있는지 확인하는 지점 (PRD ORG-005·015·036).
// 결재 문서·결재선은 M4에서 생기므로 지금은 항상 0건이다. M4에서 이 함수들이 문서 테이블을 조회하도록 바꾼다.
import type { Tx } from "@fmerp/db";

export async function countInFlightForBusiness(_tx: Tx, _businessId: string): Promise<number> {
  return 0;
}

export async function countInFlightForDepartment(_tx: Tx, _departmentId: string): Promise<number> {
  return 0;
}
