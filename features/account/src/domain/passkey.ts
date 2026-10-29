// passkey 정책 (PK1b). 순수 규칙이며 프레임워크·DB를 import하지 않는다.

/**
 * 마지막 passkey는 지울 수 없다. 지운 뒤에도 1개 이상 남아야 로그인 수단이 남는다.
 * 소유한 passkey 개수를 받아 삭제 후에도 남는지 본다.
 */
export function canDeletePasskey(ownedCount: number): boolean {
  return ownedCount > 1;
}
