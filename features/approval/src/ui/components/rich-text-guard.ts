import { isSafeRichText } from "@fmerp/shared/domain/rich-text-safety";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { toast } from "sonner";

const MAX_PASTE_LENGTH = 100_000;

export function handleRichTextPaste(view: EditorView, event: ClipboardEvent): boolean {
  // DOM 이벤트 단계에서 처리해야 ProseMirror가 공격 HTML을 파싱하지 않는다.
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text || text.length > MAX_PASTE_LENGTH) {
    toast.error("붙여넣을 수 없습니다. 크기를 줄이거나 일반 텍스트로 복사해 주세요.");
    return true;
  }
  view.dispatch(view.state.tr.insertText(text).scrollIntoView());
  return true;
}

export function richTextGuard() {
  return new Plugin({
    filterTransaction: (tr) => {
      if (!tr.docChanged || isSafeRichText(tr.doc.toJSON())) return true;
      toast.error("본문 크기 또는 표 크기 제한을 초과했습니다. 변경 사항은 적용되지 않았습니다.");
      return false;
    },
    props: {
      handleDOMEvents: {
        paste: handleRichTextPaste,
        drop: (_view, event) => {
          event.preventDefault();
          toast.error("끌어놓기는 지원하지 않습니다. 일반 텍스트로 붙여넣어 주세요.");
          return true;
        },
      },
    },
  });
}

export const RichTextGuard = Extension.create({
  name: "richTextGuard",
  priority: 10000,
  addProseMirrorPlugins() {
    return [richTextGuard()];
  },
});
