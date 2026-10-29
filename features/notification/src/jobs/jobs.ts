// 알림 작업 (M8): 결재 이벤트 소비, 텔레그램 발송 큐, 수신 방식 관리.

import type { OpsAlertRules } from "@fmerp/shared/contracts/ops-alerts";
import type { PgBoss } from "pg-boss";
import { createAuditReviewAlerts, createBackupAlerts } from "../service/alerts";
import { consumeEvents } from "../service/consume";
import { type PushDeps, PushSendError, sendPushNotification } from "../service/push";
import { type Logger, ReceiverManager } from "../service/receiver";
import { safeErrorText } from "../service/safe-error";
import { pendingTelegram, type SendDeps, sendTelegramNotification } from "../service/send";
import type { TelegramClient } from "../service/telegram-api";

/** 합성 루트(worker)가 봇 토큰으로 클라이언트를 만들 수 있도록 진입점에서 내보낸다 */
export { TelegramClient } from "../service/telegram-api";

export const NOTIFY_TELEGRAM = "notify.telegram";
export const NOTIFY_PUSH = "notify.push";
/** 웹 푸시 일시 오류 재시도 횟수 (텔레그램과 같은 정책) */
export const PUSH_RETRY_LIMIT = 3;
/** 일시 오류 재시도 횟수. 마지막 시도에서 실패하면 FAILED로 남긴다 */
export const TELEGRAM_RETRY_LIMIT = 3;

interface TelegramJob {
  accountId: string;
  notificationId: string;
}

export interface NotificationJobDeps extends Omit<SendDeps, "client"> {
  client: TelegramClient | null;
  /** 웹 푸시 키 세 값이 모두 있을 때만 준다. 없으면 푸시 채널이 꺼진다 */
  vapid: PushDeps["vapid"] | null;
  /** 푸시 서버 호출 함수. 시험에서만 바꾼다 (기본: 전역 fetch) */
  pushFetch?: typeof fetch;
  webhook: { url: string; secret: string } | null;
  /** 감사·백업 기능의 판정 규칙 (운영 알림이 쓴다) */
  rules: OpsAlertRules;
  /** 덤프 문제 알림을 받을 시스템 관리자 이메일 목록 (없으면 덤프 알림이 꺼진다) */
  systemAdminEmails?: string;
  logger: Logger;
}

export interface NotificationJobs {
  stop(): Promise<void>;
}

const errorText = safeErrorText;

const enqueue = (boss: PgBoss, job: TelegramJob) =>
  boss.send(NOTIFY_TELEGRAM, job, {
    // 같은 알림은 한 번에 하나만 큐에 있다
    singletonKey: job.notificationId,
    retryLimit: TELEGRAM_RETRY_LIMIT,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
  });

/** 웹 푸시 큐. 텔레그램 큐와 같은 알림을 따로 보내므로 singletonKey도 채널마다 다르다 */
const enqueuePush = (boss: PgBoss, job: TelegramJob) =>
  boss.send(NOTIFY_PUSH, job, {
    singletonKey: `push:${job.notificationId}`,
    retryLimit: PUSH_RETRY_LIMIT,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
  });

export async function registerNotificationJobs(
  boss: PgBoss,
  deps: NotificationJobDeps,
): Promise<NotificationJobs> {
  const { appDb, logger } = deps;
  const client = deps.client;
  const timers: NodeJS.Timeout[] = [];
  let manager: ReceiverManager | null = null;

  const vapid = deps.vapid;
  if (vapid) {
    await boss.createQueue(NOTIFY_PUSH);
    await boss.work<TelegramJob>(NOTIFY_PUSH, async ([job]) => {
      if (!job) return;
      try {
        await sendPushNotification(
          { appDb, vapid, ...(deps.pushFetch ? { fetch: deps.pushFetch } : {}) },
          job.data,
        );
      } catch (error) {
        // 일시 오류(429·5xx)만 여기로 온다. 메시지만 남기고 pg-boss가 재시도한다
        if (error instanceof PushSendError) {
          logger.error(`[worker] 웹 푸시 발송 실패(${job.retryCount}회째): ${errorText(error)}`);
        }
        throw error;
      }
    });
  } else {
    logger.info("[worker] VAPID 키가 없어 웹 푸시 알림이 꺼져 있습니다 (텔레그램·인앱만)");
  }

  if (client) {
    await boss.createQueue(NOTIFY_TELEGRAM);
    await boss.work<TelegramJob>(NOTIFY_TELEGRAM, async ([job]) => {
      if (!job) return;
      const lastAttempt = job.retryCount >= TELEGRAM_RETRY_LIMIT;
      try {
        await sendTelegramNotification({ ...deps, client }, job.data, lastAttempt);
      } catch (error) {
        // 오류 객체 전체는 남기지 않고 메시지만 남긴다 (토큰은 메시지에 들어가지 않는다)
        logger.error(`[worker] 텔레그램 발송 실패(${job.retryCount}회째): ${errorText(error)}`);
        throw error;
      }
    });
    manager = new ReceiverManager({
      appDb,
      authDb: deps.authDb,
      client,
      webhook: deps.webhook,
      logger,
    });
  } else {
    logger.info("[worker] TELEGRAM_BOT_TOKEN이 없어 텔레그램 알림이 꺼져 있습니다 (인앱 알림만)");
  }

  // 이벤트 소비와 누락 보정은 5초마다. cron은 분 단위라 결재 알림이 늦어져 타이머를 쓴다
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await consumeEvents(appDb, {
        telegram: client !== null,
        onCreated: async (created) => {
          for (const n of created) {
            if (client) await enqueue(boss, { accountId: n.accountId, notificationId: n.id });
            if (vapid) await enqueuePush(boss, { accountId: n.accountId, notificationId: n.id });
          }
        },
        onError: (event, error) =>
          logger.error(`[worker] 알림 생성 실패(${event.type}): ${errorText(error)}`),
      });
      if (client) {
        for (const job of await pendingTelegram(appDb, 30)) await enqueue(boss, job);
      }
    } catch (error) {
      logger.error(`[worker] 알림 처리 오류: ${errorText(error)}`);
    } finally {
      running = false;
    }
  };
  timers.push(setInterval(tick, 5000));
  void tick();

  // 월간 점검 누락·덤프 문제는 사건이 DB 상태로 정해지므로 30분마다 판정한다 (같은 사건은 한 번만 알린다)
  let alerting = false;
  const alertTick = async () => {
    if (alerting) return;
    alerting = true;
    try {
      const alertDeps = {
        appDb,
        authDb: deps.authDb,
        now: new Date(),
        rules: deps.rules,
        telegram: client !== null,
      };
      const created = [
        ...(await createAuditReviewAlerts(alertDeps)),
        ...(await createBackupAlerts(alertDeps, deps.systemAdminEmails)),
      ];
      for (const n of created) {
        await enqueue(boss, { accountId: n.accountId, notificationId: n.id });
      }
    } catch (error) {
      logger.error(`[worker] 운영 알림 판정 오류: ${errorText(error)}`);
    } finally {
      alerting = false;
    }
  };
  timers.push(setInterval(alertTick, 30 * 60_000));
  void alertTick();

  if (manager) {
    const m = manager;
    // 설정(폴링/웹훅)을 30초마다 확인해 맞춘다
    timers.push(setInterval(() => void m.reconcile(), 30_000));
    void m.reconcile();
  }

  return {
    async stop() {
      for (const t of timers) clearInterval(t);
      await manager?.stop();
    },
  };
}
