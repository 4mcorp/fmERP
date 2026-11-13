"use client";

import { isSafeRichText } from "@fmerp/shared/domain/rich-text-safety";
import { Button } from "@fmerp/shared/ui/button";
import type { JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Bold, Heading2, Italic, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { editorSupportsRichText, legacyRichText } from "./rich-text-fallback";
import { richTextExtensions } from "./rich-text-schema";

const tableStyles =
  "[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:align-top [&_td]:break-words [&_th]:break-words";

const EMPTY: JSONContent = { type: "doc", content: [] };

function Toolbar({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const items = [
    {
      label: "굵게",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      label: "기울임",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      label: "소제목",
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      label: "글머리 기호 목록",
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      label: "번호 목록",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      label: "실행 취소",
      icon: Undo2,
      run: () => editor.chain().focus().undo().run(),
      active: false,
    },
    {
      label: "다시 실행",
      icon: Redo2,
      run: () => editor.chain().focus().redo().run(),
      active: false,
    },
  ] as const;
  return (
    <div role="toolbar" aria-label="본문 서식" className="flex flex-wrap gap-1 border-b p-1">
      {items.map(({ label, icon: Icon, run, active }) => (
        <Button
          key={label}
          type="button"
          size="icon-sm"
          variant={active ? "secondary" : "ghost"}
          aria-label={label}
          aria-pressed={active}
          onClick={run}
        >
          <Icon aria-hidden />
        </Button>
      ))}
      {[
        {
          label: "표 삽입",
          run: () =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          disabled: editor.isActive("table"),
        },
        {
          label: "위에 행 추가",
          run: () => editor.chain().focus().addRowBefore().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "아래에 행 추가",
          run: () => editor.chain().focus().addRowAfter().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "행 삭제",
          run: () => editor.chain().focus().deleteRow().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "왼쪽에 열 추가",
          run: () => editor.chain().focus().addColumnBefore().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "오른쪽에 열 추가",
          run: () => editor.chain().focus().addColumnAfter().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "열 삭제",
          run: () => editor.chain().focus().deleteColumn().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "제목 행 전환",
          run: () => editor.chain().focus().toggleHeaderRow().run(),
          disabled: !editor.isActive("table"),
        },
        {
          label: "표 삭제",
          run: () => editor.chain().focus().deleteTable().run(),
          disabled: !editor.isActive("table"),
        },
      ].map(({ label, run, disabled }) => (
        <Button
          key={label}
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={run}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** 리치 텍스트 본문 편집기 (APV-001, Tiptap). 값은 Tiptap 문서(JSON)이다 */
export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  labelledBy,
}: {
  id: string;
  value: JSONContent | undefined;
  onChange: (value: JSONContent) => void;
  invalid?: boolean;
  describedBy?: string;
  /** 편집 영역을 이름 붙이는 라벨 요소의 id (div는 label for로 연결되지 않는다) */
  labelledBy?: string;
}) {
  const safe = value === undefined || (isSafeRichText(value) && editorSupportsRichText(value));
  const editor = useEditor({
    extensions: richTextExtensions,
    shouldRerenderOnTransaction: true,
    content: safe ? (value ?? EMPTY) : EMPTY,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        role: "textbox",
        "aria-multiline": "true",
        "aria-invalid": invalid ? "true" : "false",
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        class: `${tableStyles} prose-sm min-h-40 max-w-none px-3 py-2 outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_h2]:text-lg [&_h2]:font-semibold`,
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = e.getJSON();
      if (isSafeRichText(next)) onChange(next);
    },
  });
  // 폼 값이 밖에서 바뀌면(서버 본문 불러오기, 로컬 사본 복구) 편집기 내용도 맞춘다. 입력 중에는 건드리지 않는다
  useEffect(() => {
    if (!editor || editor.isFocused || !safe) return;
    const next = value ?? EMPTY;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value, safe]);

  if (!safe) return <LegacyRichText value={value} />;
  if (!editor) return <div className="min-h-40 rounded-lg border" aria-busy="true" />;
  return (
    <div className="rounded-lg border focus-within:ring-3 focus-within:ring-ring/50">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/** 읽기 전용 본문 표시 (문서 상세) */
export function RichTextView({ value }: { value: JSONContent | undefined }) {
  const safe = value === undefined || (isSafeRichText(value) && editorSupportsRichText(value));
  const editor = useEditor({
    extensions: richTextExtensions,
    shouldRerenderOnTransaction: true,
    content: safe ? (value ?? EMPTY) : EMPTY,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `${tableStyles} prose-sm max-w-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_h2]:text-lg [&_h2]:font-semibold`,
      },
    },
  });
  useEffect(() => {
    if (!editor || !safe) return;
    const next = value ?? EMPTY;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value, safe]);
  if (!safe) return <LegacyRichText value={value} />;
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function LegacyRichText({ value }: { value: unknown }) {
  const text = legacyRichText(value);
  return (
    <div role="alert">
      {text === null ? (
        "본문이 너무 크거나 손상되어 표시할 수 없습니다."
      ) : (
        <>
          안전하지 않은 본문 또는 지원하지 않는 본문입니다. 원문을 읽을 수 있지만 편집할 수
          없습니다.
          <pre className="whitespace-pre-wrap break-words">{text}</pre>
        </>
      )}
    </div>
  );
}
