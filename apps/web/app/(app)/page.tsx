"use client";

import { FilePlus2, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminEntry } from "@/lib/admin-nav";
import {
  useCapabilities,
  useCurrentAccount,
  useForms,
  useMe,
  useMine,
  usePending,
} from "@/lib/queries";
import {
  DOC_STATUS_LABEL,
  formatDateTime,
  type MineItem,
  ROLE_LABEL,
  STEP_TYPE_LABEL,
} from "@/lib/types";

/** 홈에 보이는 목록의 최대 건수. 더 보려면 각 문서함으로 간다 */
const LIST_SIZE = 5;
/** 바로가기에 보이는 양식 수 */
const SHORTCUT_SIZE = 6;

function Section({
  title,
  description,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  description?: string;
  href: string;
  hrefLabel: string;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link href={href}>
              {hrefLabel}
              <span className="sr-only"> — {title}</span>
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

function DocRow({ href, title, meta }: { href: string; title: string; meta: ReactNode }) {
  return (
    <li>
      <Link href={href} className="block rounded-md px-2 py-2 hover:bg-muted/50">
        <span className="block break-words font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{meta}</span>
      </Link>
    </li>
  );
}

const byUpdatedDesc = (a: MineItem, b: MineItem) => b.updatedAt.localeCompare(a.updatedAt);

/** 홈: 결재 대기, 진행 중 문서, 최근 완료 문서, 자주 쓰는 양식 바로가기 (PRD DSH-001) */
export default function HomePage() {
  const router = useRouter();
  const { data: me } = useMe();
  const enabled = Boolean(me?.activeAccountId);
  const { data: account } = useCurrentAccount(enabled);
  const { data: caps } = useCapabilities(enabled);
  const { data: pending } = usePending(enabled);
  const { data: mine } = useMine();
  const { data: forms } = useForms();

  // 소속 회사가 없으면 회사 만들기·초대 합류 화면으로 보낸다 (AUTH-005)
  useEffect(() => {
    if (me && !me.activeAccountId) router.replace("/onboarding");
  }, [me, router]);

  const inProgress = useMemo(
    () =>
      (mine ?? [])
        .filter((d) => d.status === "IN_PROGRESS" || d.status === "ON_HOLD")
        .sort(byUpdatedDesc),
    [mine],
  );
  const drafts = useMemo(() => (mine ?? []).filter((d) => d.status === "DRAFT"), [mine]);
  const recentDone = useMemo(
    () => (mine ?? []).filter((d) => d.status === "COMPLETED").sort(byUpdatedDesc),
    [mine],
  );
  // 즐겨찾기를 먼저, 그다음 최근 사용한 양식
  const shortcuts = useMemo(() => {
    const list = (forms ?? []).filter((f) => f.active);
    const favorites = list.filter((f) => f.favorite);
    const recent = list
      .filter((f) => !f.favorite && f.lastUsedAt)
      .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
    return [...favorites, ...recent].slice(0, SHORTCUT_SIZE);
  }, [forms]);

  if (!me || !account) return null;
  const adminLink = adminEntry(caps);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <p className="text-muted-foreground">
            {me.name}님 · {ROLE_LABEL[account.myRole]}
          </p>
        </div>
        <Button asChild>
          <Link href="/approval/new">
            <FilePlus2 aria-hidden />새 결재
          </Link>
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          { href: "/approval/pending", label: "결재 대기", value: pending?.length, accent: true },
          { href: "/approval/mine", label: "진행 중", value: mine ? inProgress.length : undefined },
          { href: "/approval/mine", label: "임시저장", value: mine ? drafts.length : undefined },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="rounded-lg border p-3 hover:bg-muted/50">
            <dt className="text-sm text-muted-foreground">{s.label}</dt>
            <dd className={`text-2xl font-semibold ${s.accent && s.value ? "text-primary" : ""}`}>
              {s.value ?? "–"}
              {s.value !== undefined && <span className="ml-0.5 text-sm font-normal">건</span>}
            </dd>
          </Link>
        ))}
      </dl>

      <Section
        title="결재 대기"
        description="지금 내가 처리할 차례인 문서"
        href="/approval/pending"
        hrefLabel="모두 보기"
      >
        {!pending ? (
          <Empty>불러오는 중…</Empty>
        ) : pending.length === 0 ? (
          <Empty>처리할 결재가 없습니다.</Empty>
        ) : (
          <ul className="space-y-1">
            {pending.slice(0, LIST_SIZE).map((d) => (
              <DocRow
                key={`${d.documentId}-${d.stepId}`}
                href={`/approval/${d.documentId}`}
                title={d.title}
                meta={
                  <span className="flex flex-wrap items-center gap-1.5">
                    {d.urgent && <Badge variant="destructive">긴급</Badge>}
                    {d.asDelegate && <Badge variant="secondary">대결</Badge>}
                    <span>
                      {d.drafterSnapshot.name ?? "기안자"} · {STEP_TYPE_LABEL[d.stepType]} 차례
                    </span>
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="내가 올린 진행 중 문서" href="/approval/mine" hrefLabel="기안함">
          {!mine ? (
            <Empty>불러오는 중…</Empty>
          ) : inProgress.length === 0 ? (
            <Empty>진행 중인 문서가 없습니다.</Empty>
          ) : (
            <ul className="space-y-1">
              {inProgress.slice(0, LIST_SIZE).map((d) => (
                <DocRow
                  key={d.id}
                  href={`/approval/${d.id}`}
                  title={d.title}
                  meta={`${DOC_STATUS_LABEL[d.status] ?? d.status}${
                    d.submittedAt ? ` · ${formatDateTime(d.submittedAt)} 상신` : ""
                  }`}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="최근 완료 문서" href="/mailbox" hrefLabel="문서함">
          {!mine ? (
            <Empty>불러오는 중…</Empty>
          ) : recentDone.length === 0 ? (
            <Empty>완료된 문서가 없습니다.</Empty>
          ) : (
            <ul className="space-y-1">
              {recentDone.slice(0, LIST_SIZE).map((d) => (
                <DocRow
                  key={d.id}
                  href={`/approval/${d.id}`}
                  title={d.title}
                  meta={`${d.docNo ?? "문서번호 없음"} · ${formatDateTime(d.updatedAt)}`}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="자주 쓰는 양식"
        description="즐겨찾기한 양식과 최근 사용한 양식"
        href="/approval/new"
        hrefLabel="모든 양식"
      >
        {!forms ? (
          <Empty>불러오는 중…</Empty>
        ) : shortcuts.length === 0 ? (
          <Empty>
            아직 자주 쓰는 양식이 없습니다. 새 결재 화면에서 양식에 별표를 누르면 여기에 모입니다.
          </Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shortcuts.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/approval/new?form=${f.id}`}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  {f.favorite && <Star className="size-4 shrink-0 fill-current" aria-hidden />}
                  <span className="min-w-0 truncate font-medium">{f.name}</span>
                  {f.favorite && <span className="sr-only">(즐겨찾기)</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <nav aria-label="바로가기" className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/me">내 정보</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/org">조직도</Link>
        </Button>
        {adminLink && (
          <Button asChild variant="outline" size="sm">
            <Link href={adminLink}>관리 콘솔</Link>
          </Button>
        )}
      </nav>
    </div>
  );
}
