// 웹 푸시 (PWA 홈 화면 앱·브라우저) 구독 저장과 발송. 재시도는 호출하는 쪽(pg-boss)이 맡는다.
// 외부 푸시 서버로 나가는 문구는 텔레그램과 같다: 문서 제목·내용·의견을 넣지 않는 `externalText`만 보낸다.

import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";
import { type Db, schema, type Tx, withTenant } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { notificationPath } from "../domain/notification-rules";

export interface PushDeps {
  appDb: Db;
  /** 세 값이 모두 있어야 한다. 없으면 호출하지 않는다(푸시 꺼짐) */
  vapid: VapidKeys;
  fetch?: typeof fetch;
}

/** VAPID 세 값이 모두 있을 때만 키를 돌려준다. 없으면 null (푸시 꺼짐) */
export function vapidFromEnv(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 구독을 저장한다. 같은 주소(endpoint)는 한 번만 둔다 */
export async function saveSubscription(
  tx: Tx,
  accountId: string,
  membershipId: string,
  input: SubscriptionInput,
): Promise<void> {
  await tx
    .delete(schema.pushSubscription)
    .where(eq(schema.pushSubscription.endpoint, input.endpoint));
  await tx.insert(schema.pushSubscription).values({
    accountId,
    membershipId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
  });
}

/** 이 구성원의 구독 하나를 지운다 (남의 구독은 RLS·구성원 조건으로 건드리지 못한다) */
export async function removeSubscription(
  tx: Tx,
  membershipId: string,
  endpoint: string,
): Promise<void> {
  await tx
    .delete(schema.pushSubscription)
    .where(
      and(
        eq(schema.pushSubscription.endpoint, endpoint),
        eq(schema.pushSubscription.membershipId, membershipId),
      ),
    );
}

/** 발송 결과. `gone`: 구독이 만료되어 지웠다. `none`: 보낼 기기가 없다 */
export type PushOutcome = "sent" | "gone" | "none";

/** 재시도해야 하는 응답인지: 요청 제한(429)과 서버 오류(5xx) */
const transient = (status: number) => status === 429 || status >= 500;

export class PushSendError extends Error {
  constructor(readonly status: number) {
    super(`웹 푸시 발송 실패 (${status})`);
  }
}

/**
 * 알림 한 건을 구성원의 모든 기기로 보낸다. 404·410(구독 만료)은 구독을 지우고 넘어간다.
 * 일시 오류(429·5xx)는 마지막에 던져서 pg-boss가 재시도하게 한다.
 */
export async function sendPushNotification(
  deps: PushDeps,
  job: { accountId: string; notificationId: string },
): Promise<PushOutcome> {
  const fetchFn = deps.fetch ?? fetch;
  const loaded = await withTenant(deps.appDb, job.accountId, async (tx) => {
    const [n] = await tx
      .select({
        recipient: schema.notification.recipientMembershipId,
        text: schema.notification.externalText,
        kind: schema.notification.kind,
        documentId: schema.notification.documentId,
      })
      .from(schema.notification)
      .where(eq(schema.notification.id, job.notificationId));
    if (!n) return null;
    const subs = await tx
      .select({
        id: schema.pushSubscription.id,
        endpoint: schema.pushSubscription.endpoint,
        p256dh: schema.pushSubscription.p256dh,
        auth: schema.pushSubscription.auth,
      })
      .from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.membershipId, n.recipient));
    return { n, subs };
  });
  if (!loaded || loaded.subs.length === 0) return "none";

  // 문구는 외부 채널용 문구다. 문서 제목은 들어가지 않는다. 경로는 앱 안의 상대 경로다
  const message = {
    data: {
      title: "4mERP",
      body: loaded.n.text,
      path: notificationPath(loaded.n.kind, loaded.n.documentId),
    },
    options: { ttl: 3600, urgency: "normal" as const },
  };

  let outcome: PushOutcome = "none";
  let retryStatus: number | null = null;
  for (const sub of loaded.subs) {
    const subscription: PushSubscription = {
      endpoint: sub.endpoint,
      expirationTime: null,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    const { headers, method, body } = await buildPushPayload(message, subscription, deps.vapid);
    const res = await fetchFn(sub.endpoint, { method, headers, body });
    if (res.status === 404 || res.status === 410) {
      await withTenant(deps.appDb, job.accountId, (tx) =>
        tx.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, sub.id)),
      );
      outcome = outcome === "sent" ? "sent" : "gone";
      continue;
    }
    if (!res.ok) {
      if (transient(res.status)) retryStatus = res.status;
      continue;
    }
    outcome = "sent";
  }
  if (retryStatus !== null) throw new PushSendError(retryStatus);
  return outcome;
}
