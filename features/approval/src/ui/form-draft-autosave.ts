import type { FormLayout } from "@fmerp/shared/domain/form-layout";
import type { FormSchema } from "@fmerp/shared/domain/form-schema";
import { ApiProblem, api, errorMessage } from "@fmerp/shared/lib/api";
import { useEffect, useRef, useState } from "react";

export interface FormDraftValue {
  schema: FormSchema;
  layout: FormLayout;
}
export interface FormDraft extends FormDraftValue {
  revision: number;
  updatedAt: string;
}
export type DraftStatus =
  | { kind: "saved" | "pending" | "saving"; warnings: string[] }
  | { kind: "error" | "conflict"; message: string; warnings: string[] };

/** 한 세션의 PUT을 직렬화한다. 실패하면 같은 revision을 유지한다. */
export class FormDraftAutosave {
  private latest: FormDraftValue;
  private saved: string;
  private running: Promise<void> | null = null;
  private blocked = false;
  private conflict = false;
  private valid = true;
  private warnings: string[] = [];
  constructor(
    private revision: number,
    initial: FormDraftValue,
    private put: (
      value: FormDraftValue & { revision: number },
    ) => Promise<{ draft: FormDraft; warnings: string[] }>,
    private notify: (status: DraftStatus) => void,
  ) {
    this.latest = initial;
    this.saved = JSON.stringify(initial);
  }
  update(value: FormDraftValue, valid = true) {
    this.latest = value;
    this.valid = valid;
    if (!this.blocked)
      this.notify({
        kind: !this.running && JSON.stringify(value) === this.saved ? "saved" : "pending",
        warnings: this.warnings,
      });
  }
  retry() {
    if (!this.conflict) this.blocked = false;
    return this.flush();
  }
  async flush(): Promise<void> {
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (!this.valid) throw new Error("구조 오류를 먼저 고치세요");
    if (this.blocked) throw new Error("초안 저장 문제를 먼저 해결하세요");
    if (JSON.stringify(this.latest) === this.saved) return;
    const value = this.latest;
    this.notify({ kind: "saving", warnings: [] });
    this.running = (async () => {
      try {
        const result = await this.put({ ...value, revision: this.revision });
        this.revision = result.draft.revision;
        this.saved = JSON.stringify(value);
        this.warnings = result.warnings;
        this.notify({
          kind: JSON.stringify(this.latest) === this.saved ? "saved" : "pending",
          warnings: result.warnings,
        });
      } catch (error) {
        this.blocked = true;
        this.conflict = error instanceof ApiProblem && error.status === 409;
        this.notify({
          kind: this.conflict ? "conflict" : "error",
          message: errorMessage(error),
          warnings: [],
        });
        throw error;
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (JSON.stringify(this.latest) !== this.saved) await this.flush();
  }
}

export function useFormDraftAutosave(
  formId: string | undefined,
  value: FormDraftValue | null,
  revision: number,
  valid: boolean,
) {
  const [status, setStatus] = useState<DraftStatus>({ kind: "saved", warnings: [] });
  const session = useRef<FormDraftAutosave | null>(null);
  if (formId && value && !session.current)
    session.current = new FormDraftAutosave(
      revision,
      value,
      (body) => api(`/api/forms/${formId}/draft`, { method: "PUT", body }),
      setStatus,
    );
  useEffect(() => {
    if (!value || !session.current) return;
    session.current.update(value, valid);
    if (!valid) return;
    const timer = setTimeout(() => {
      session.current?.flush().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [value, valid]);
  useEffect(() => {
    if (status.kind === "saved") return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        anchor instanceof HTMLAnchorElement &&
        anchor.origin === window.location.origin &&
        anchor.pathname !== window.location.pathname &&
        !window.confirm("초안이 저장되지 않았습니다. 현재 내용을 두고 이동할까요?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", navigate, true);
    };
  }, [status.kind]);
  return {
    status,
    flush: () => {
      if (value) session.current?.update(value, valid);
      return session.current?.flush() ?? Promise.resolve();
    },
    retry: () => session.current?.retry().catch(() => {}),
  };
}
