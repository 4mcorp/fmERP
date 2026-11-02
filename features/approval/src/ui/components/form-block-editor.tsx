"use client";

import {
  FORM_PAGE_GUIDE_MARGIN_MM,
  formPageGuideHeightMm,
} from "@fmerp/shared/domain/document-preview-scale";
import { FORM_BLOCK_CSS, FORM_BLOCK_FONT_CSS } from "@fmerp/shared/domain/form-block-style";
import { renderBlocks } from "@fmerp/shared/domain/form-blocks";
import { type Block, type FormLayout, resolveBlocks } from "@fmerp/shared/domain/form-layout";
import type { FormField, FormSchema } from "@fmerp/shared/domain/form-schema";
import { Button } from "@fmerp/shared/ui/button";
import { FormBlocks } from "@fmerp/shared/ui/form-blocks";
import { type Editor, Extension, type JSONContent, Node } from "@tiptap/core";
import DragHandle, { type DragHandleProps } from "@tiptap/extension-drag-handle-react";
import NodeRange from "@tiptap/extension-node-range";
import { Plugin } from "@tiptap/pm/state";
import {
  EditorContent,
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { blocksToDocument, documentToLayout } from "./form-block-document";
import { blankField, FIELD_TYPE_LABEL, FieldEditor } from "./form-field-editor";

interface EditorSession {
  fields: Map<string, FormField>;
  changeField(field: FormField): void;
}
const Session = createContext<EditorSession | null>(null);
function useSession() {
  const value = useContext(Session);
  if (!value) throw new Error("양식 편집기 세션이 없습니다");
  return value;
}

function FieldView({ node, deleteNode, editor, getPos }: NodeViewProps) {
  const session = useSession();
  const field = session.fields.get(String(node.attrs.fieldKey));
  const [open, setOpen] = useState(false);
  const pos = getPos();
  const resolved = pos === undefined ? undefined : editor.state.doc.resolve(pos);
  const index = resolved?.index() ?? 0;
  const total = resolved?.parent.childCount ?? 1;
  if (!field) return <NodeViewWrapper>필드 정의가 없습니다</NodeViewWrapper>;
  return (
    <NodeViewWrapper data-field-key={field.key} contentEditable={false}>
      <FormBlocks
        includeStyles={false}
        schema={{ fields: [field] }}
        layout={{ blocks: [{ kind: "field", key: field.key }] }}
        mode="edit"
        renderField={() => (
          <span>
            {FIELD_TYPE_LABEL[field.type]}
            {field.required ? " · 필수" : ""}
            {field.help ? ` · ${field.help}` : ""}
            {field.type === "table" ? (
              <table className="grid">
                <thead>
                  <tr>
                    {field.columns.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {field.columns.map((col) => (
                      <td key={col.key}>입력값</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            ) : null}
          </span>
        )}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-label={`${field.label} 설정`}
        onClick={() => setOpen(!open)}
      >
        필드 설정
      </Button>
      {open ? (
        <ol className="block-settings">
          <FieldEditor
            field={field}
            index={index}
            total={total}
            onChange={session.changeField}
            onMove={(to) => {
              if (pos === undefined || !resolved) return;
              const neighbor = resolved.parent.child(to);
              const target = to < index ? pos - neighbor.nodeSize : pos + neighbor.nodeSize;
              editor.view.dispatch(
                editor.state.tr.delete(pos, pos + node.nodeSize).insert(target, node),
              );
            }}
            onRemove={deleteNode}
          />
        </ol>
      ) : null}
    </NodeViewWrapper>
  );
}

function TextView({ node }: NodeViewProps) {
  const block: Block =
    node.type.name === "formHeading"
      ? { kind: "heading", level: node.attrs.level === 1 ? 1 : 2, text: node.textContent }
      : { kind: "text", text: node.textContent };
  return (
    <NodeViewWrapper>
      <FormBlocks
        includeStyles={false}
        schema={{ fields: [] }}
        layout={{ blocks: [block] }}
        mode="edit"
        renderField={() => undefined}
        renderText={() => <NodeViewContent<"span"> as="span" />}
      />
    </NodeViewWrapper>
  );
}
function StaticView({ node, deleteNode }: NodeViewProps) {
  const block: Block = { kind: node.type.name === "formDivider" ? "divider" : "pagebreak" };
  return (
    <NodeViewWrapper contentEditable={false}>
      <FormBlocks
        includeStyles={false}
        schema={{ fields: [] }}
        layout={{ blocks: [block] }}
        mode="edit"
        renderField={() => undefined}
      />
      <Button type="button" size="sm" variant="ghost" onClick={deleteNode}>
        {block.kind === "divider" ? "구분선" : "쪽 나눔"} 삭제
      </Button>
    </NodeViewWrapper>
  );
}
function ColumnsView({ node, deleteNode }: NodeViewProps) {
  // 순회·클래스는 공통 렌더러, contentDOM과 열 자식은 ProseMirror 소유다.
  const body = renderBlocks<ReactNode>({
    fields: [],
    blocks: [{ kind: "columns", cols: Array.from({ length: node.childCount }, () => []) }],
    mode: "edit",
    adapter: {
      text: (value) => value,
      field: () => undefined,
      element: (tag, attrs, children) =>
        attrs.class?.startsWith("block-columns block-columns-") ? (
          <NodeViewContent className={attrs.class} />
        ) : (
          createElement(tag, { className: attrs.class }, ...children)
        ),
    },
  });
  return (
    <NodeViewWrapper>
      {body}
      <Button type="button" size="sm" variant="ghost" contentEditable={false} onClick={deleteNode}>
        열 묶음 삭제
      </Button>
    </NodeViewWrapper>
  );
}
function ColumnView() {
  return (
    <NodeViewWrapper className="block-column">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
const FormFieldNode = Node.create({
  name: "formField",
  group: "leaf",
  atom: true,
  draggable: true,
  addAttributes: () => ({ fieldKey: { default: null } }),
  parseHTML: () => [{ tag: "div[data-form-field]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", { "data-form-field": "", ...HTMLAttributes }],
  addNodeView: () => ReactNodeViewRenderer(FieldView),
});
const Paragraph = Node.create({
  name: "paragraph",
  group: "leaf",
  content: "text*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
  addNodeView: () => ReactNodeViewRenderer(TextView),
});
const Heading = Node.create({
  name: "formHeading",
  group: "leaf",
  content: "text*",
  addAttributes: () => ({ level: { default: 2 } }),
  parseHTML: () => [
    { tag: "h1", attrs: { level: 1 } },
    { tag: "h2", attrs: { level: 2 } },
  ],
  renderHTML: ({ node }) => [node.attrs.level === 1 ? "h1" : "h2", 0],
  addNodeView: () => ReactNodeViewRenderer(TextView),
});
const Columns = Node.create({
  name: "formColumns",
  group: "block",
  content: "formColumn{2,4}",
  draggable: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-form-columns]" }],
  renderHTML: () => ["div", { "data-form-columns": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(ColumnsView),
});
const Column = Node.create({
  name: "formColumn",
  content: "leaf*",
  isolating: true,
  parseHTML: () => [{ tag: "div[data-form-column]" }],
  renderHTML: () => ["div", { "data-form-column": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(ColumnView),
});
const Divider = Node.create({
  name: "formDivider",
  group: "leaf",
  atom: true,
  draggable: true,
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: () => ["hr"],
  addNodeView: () => ReactNodeViewRenderer(StaticView),
});
const Pagebreak = Divider.extend({
  name: "formPagebreak",
  parseHTML: () => [{ tag: "div[data-pagebreak]" }],
  renderHTML: () => ["div", { "data-pagebreak": "" }],
});

const choices = [
  ...Object.entries(FIELD_TYPE_LABEL).map(([value, label]) => ({ value, label })),
  { value: "heading1", label: "제목" },
  { value: "heading2", label: "소제목" },
  { value: "paragraph", label: "설명" },
  { value: "divider", label: "구분선" },
  { value: "pagebreak", label: "쪽나눔" },
  ...[2, 3, 4].map((n) => ({ value: `columns${n}`, label: `${n}열` })),
];
type Choice = (typeof choices)[number];

function slash(insert: (value: string, range: { from: number; to: number }) => void) {
  return Extension.create({
    name: "formSlash",
    addProseMirrorPlugins() {
      return [
        Suggestion<Choice, Choice>({
          editor: this.editor,
          char: "/",
          startOfLine: true,
          items: ({ query }) => choices.filter((item) => item.label.includes(query)),
          command: ({ props, range }) => insert(props.value, range),
          allow: ({ state, range }) =>
            state.doc.resolve(range.from).parent.type.name === "paragraph",
          render: () => {
            let menu: HTMLDivElement | undefined;
            let unmount: (() => void) | undefined;
            let current: SuggestionProps<Choice, Choice>;
            let selected = 0;
            const paint = (props: SuggestionProps<Choice, Choice>) => {
              current = props;
              selected = 0;
              if (!menu) {
                menu = document.createElement("div");
                menu.className = "form-slash-menu";
                menu.id = `form-slash-${crypto.randomUUID()}`;
                menu.setAttribute("role", "menu");
                menu.setAttribute("aria-label", "블록 추가");
                unmount = props.mount(menu);
              }
              props.editor.view.dom.setAttribute("aria-controls", menu.id);
              props.editor.view.dom.setAttribute("aria-haspopup", "menu");
              props.editor.view.dom.setAttribute("aria-expanded", "true");
              props.editor.view.dom.removeAttribute("aria-activedescendant");
              menu.replaceChildren();
              if (!props.items.length) menu.textContent = "일치하는 블록이 없습니다";
              props.items.forEach((item, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.setAttribute("role", "menuitem");
                button.textContent = item.label;
                button.tabIndex = -1;
                button.id = `${menu?.id}-${index}`;
                button.dataset.selected = String(index === selected);
                button.onmousedown = (event) => event.preventDefault();
                button.onclick = () => props.command(item);
                if (index === selected)
                  props.editor.view.dom.setAttribute("aria-activedescendant", button.id);
                menu?.append(button);
              });
            };
            return {
              onStart: paint,
              onUpdate: paint,
              onExit: () => {
                current.editor.view.dom.removeAttribute("aria-activedescendant");
                current.editor.view.dom.removeAttribute("aria-controls");
                current.editor.view.dom.setAttribute("aria-expanded", "false");
                unmount?.();
                menu = undefined;
              },
              onKeyDown: ({ event, view }) => {
                if (event.isComposing || view.composing) return false;
                if (event.key === "Escape") {
                  exitSuggestion(view);
                  return true;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  const count = current.items.length;
                  if (count)
                    selected = (selected + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
                  menu?.querySelectorAll("button").forEach((button, index) => {
                    button.dataset.selected = String(index === selected);
                    if (index === selected) {
                      current.editor.view.dom.setAttribute("aria-activedescendant", button.id);
                      button.scrollIntoView({ block: "nearest" });
                    }
                  });
                  return true;
                }
                if (event.key === "Enter") {
                  const item = current.items[selected];
                  if (item) current.command(item);
                  return true;
                }
                return false;
              },
            };
          },
        }),
      ];
    },
  });
}

export function FormBlockEditor({
  schema,
  layout,
  onChange,
  name,
  disabled = false,
}: {
  schema: FormSchema;
  layout: FormLayout;
  name: string;
  disabled?: boolean;
  onChange: (value: { schema: FormSchema; layout: FormLayout }) => void;
}) {
  const definitions = useRef(new Map(schema.fields.map((field) => [field.key, field])));
  const callback = useRef(onChange);
  callback.current = onChange;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, refresh] = useState(0);
  const [add, setAdd] = useState("text");
  const headerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pageGuide, setPageGuide] = useState({ header: 0, height: 1005, count: 1 });
  useEffect(() => {
    const header = headerRef.current,
      body = bodyRef.current;
    if (!header || !body) return;
    const measure = () => {
      const height = (formPageGuideHeightMm(layout.orientation ?? "portrait") * 96) / 25.4;
      const headerHeight = header.getBoundingClientRect().height;
      setPageGuide({
        header: headerHeight,
        height,
        count: Math.max(1, Math.floor((body.clientHeight + headerHeight + 1) / height)),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, [layout.orientation]);
  const dragTarget = useRef<HTMLElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        document: false,
        paragraph: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        link: false,
        underline: false,
        horizontalRule: false,
        hardBreak: false,
        dropcursor: { color: "#333" },
      }),
      Node.create({ name: "doc", topNode: true, content: "(leaf | formColumns)*" }),
      Paragraph,
      Heading,
      FormFieldNode,
      Columns,
      Column,
      Divider,
      Pagebreak,
      NodeRange.configure({ key: null }),
      slash((value, range) => insert(value, range)),
      Extension.create({
        name: "uniqueFormKeys",
        addProseMirrorPlugins: () => [
          new Plugin({
            filterTransaction: (tr) => {
              const keys = new Set<string>();
              let valid = true;
              tr.doc.descendants((node) => {
                if (node.type.name === "formField") {
                  const key = String(node.attrs.fieldKey);
                  if (!definitions.current.has(key) || keys.has(key)) valid = false;
                  keys.add(key);
                }
              });
              return valid;
            },
          }),
        ],
      }),
    ],
    content: blocksToDocument(resolveBlocks(schema, layout)),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "양식 블록 편집기",
        "aria-multiline": "true",
        class: "form-block-editor-content",
      },
    },
    onUpdate: ({ editor }) =>
      callback.current(
        documentToLayout(
          editor.getJSON(),
          { fields: [...definitions.current.values()] },
          layoutRef.current,
        ),
      ),
  });
  editorRef.current = editor;
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  function emit() {
    if (editor) {
      callback.current(
        documentToLayout(
          editor.getJSON(),
          { fields: [...definitions.current.values()] },
          layoutRef.current,
        ),
      );
      refresh((n) => n + 1);
    }
  }
  function insert(value: string, range?: { from: number; to: number }) {
    const editor = editorRef.current;
    if (!editor) return;
    let node: JSONContent;
    if (value.startsWith("columns")) {
      if (editor.isActive("formColumn")) return;
      node = {
        type: "formColumns",
        content: Array.from({ length: Number(value.slice(-1)) }, () => ({
          type: "formColumn",
          content: [{ type: "paragraph" }],
        })),
      };
    } else if (value === "heading1" || value === "heading2")
      node = { type: "formHeading", attrs: { level: value === "heading1" ? 1 : 2 } };
    else if (value === "paragraph") node = { type: "paragraph" };
    else if (value === "divider" || value === "pagebreak")
      node = { type: value === "divider" ? "formDivider" : "formPagebreak" };
    else {
      const type =
        schema.fields.find((field) => field.type === value)?.type ??
        Object.keys(FIELD_TYPE_LABEL).find((key) => key === value);
      if (!type || !(type in FIELD_TYPE_LABEL)) return;
      let n = 1;
      while (definitions.current.has(`field${n}`)) n++;
      const field = blankField(type as FormField["type"], n);
      definitions.current.set(field.key, field);
      node = { type: "formField", attrs: { fieldKey: field.key } };
    }
    const position = range ?? { from: editor.state.selection.to, to: editor.state.selection.to };
    editor
      .chain()
      .focus()
      .insertContentAt(position, [node, { type: "paragraph" }])
      .run();
  }
  return (
    <Session.Provider
      value={{
        fields: definitions.current,
        changeField: (field) => {
          definitions.current.set(field.key, field);
          emit();
        },
      }}
    >
      <style>{FORM_BLOCK_FONT_CSS + FORM_BLOCK_CSS + EDITOR_CSS}</style>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="블록 작업">
        <label>
          추가할 블록{" "}
          <select
            aria-label="추가할 블록"
            value={add}
            onChange={(event) => setAdd(event.target.value)}
          >
            {choices.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" variant="outline" onClick={() => insert(add)}>
          블록 추가
        </Button>
        <Button type="button" variant="ghost" onClick={() => editor?.chain().focus().undo().run()}>
          구조 실행 취소
        </Button>
        <Button type="button" variant="ghost" onClick={() => editor?.chain().focus().redo().run()}>
          구조 다시 실행
        </Button>
      </div>
      <p>
        빈 줄에 /를 입력하세요. 열 안에서도 추가할 수 있습니다. 쪽 경계는{" "}
        {FORM_PAGE_GUIDE_MARGIN_MM}mm 여유를 둔 근사이며 공식 출력은 서버 PDF입니다.
      </p>
      <div
        className="form-editor-paper"
        style={
          {
            "--page-height": `${formPageGuideHeightMm(layout.orientation ?? "portrait")}mm`,
            "--chrome-height": `${pageGuide.header}px`,
            "--page-width": layout.orientation === "landscape" ? "297mm" : "210mm",
          } as React.CSSProperties
        }
      >
        <header ref={headerRef} contentEditable={false} className="form-editor-chrome">
          <p>문서번호 (완료 시 부여)</p>
          <h1>{name || "양식 이름"}</h1>
          {layout.approvalBoxPosition !== "bottom" ? (
            <ApprovalChrome position={layout.approvalBoxPosition} />
          ) : null}
        </header>
        <div ref={bodyRef} className="form-editor-body">
          <aside
            className="page-guides"
            aria-label={`페이지 경계 (${FORM_PAGE_GUIDE_MARGIN_MM}mm 보수 근사)`}
          >
            {Array.from({ length: pageGuide.count }, (_, index) => index + 1).map((page) => (
              <div
                key={page}
                className="page-guide"
                style={{ top: `${pageGuide.height * page - pageGuide.header}px` }}
              >
                {page}쪽 경계 (근사)
              </div>
            ))}
          </aside>
          {editor ? (
            <>
              <DragHandle
                editor={editor}
                nested
                className="form-block-drag"
                computePositionConfig={DRAG_POSITION}
                onNodeChange={({ editor, pos }) => {
                  const dom = pos < 0 ? null : editor.view.nodeDOM(pos);
                  dragTarget.current = dom instanceof HTMLElement ? dom : null;
                }}
                getReferencedVirtualElement={() => dragTarget.current}
              >
                <button type="button" aria-label="블록 드래그 이동" className="form-drag-handle">
                  ⠿
                </button>
              </DragHandle>
              <EditorContent editor={editor} />
            </>
          ) : (
            <p>편집기 준비 중…</p>
          )}
        </div>
        {layout.approvalBoxPosition === "bottom" ? <ApprovalChrome position="bottom" /> : null}
        <footer contentEditable={false} className="form-editor-chrome">
          회사명 · 문서 해시 (완료 시 생성, 편집 불가)
        </footer>
      </div>
    </Session.Provider>
  );
}

function ApprovalChrome({ position }: { position: FormLayout["approvalBoxPosition"] }) {
  return (
    <div
      className="approval-chrome"
      style={{ marginLeft: position === "top-left" ? 0 : "auto" }}
      contentEditable={false}
    >
      <p>결재란 샘플 (편집 불가)</p>
      <table>
        <thead>
          <tr>
            <th>기안</th>
            <th>검토</th>
            <th>승인</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>기안자</td>
            <td>검토자</td>
            <td>승인자</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const DRAG_POSITION: NonNullable<DragHandleProps["computePositionConfig"]> = {
  strategy: "fixed",
  placement: "left-start",
  middleware: [
    {
      name: "viewportAnchor",
      fn: ({ elements, rects }) => {
        const target = elements.reference.getBoundingClientRect();
        return { x: Math.max(0, target.left - rects.floating.width), y: target.top };
      },
    },
  ],
};
const EDITOR_CSS = `
.form-editor-paper { --background:#fff;--foreground:#111;--card:#fff;--card-foreground:#111;--muted:#f6f6f6;--muted-foreground:#555;--input:#ccc;--border:#ccc;--popover:#fff;--popover-foreground:#111;color-scheme:light;color:#111;background:#fff;font-family:Pretendard,sans-serif;width:100%;max-width:var(--page-width);margin:12px auto;border:1px solid #ccc;padding:14mm 12mm;box-sizing:border-box; }
.form-editor-chrome {font-size:10pt;padding:3mm 0;color:#444;overflow-wrap:anywhere;}
.form-editor-chrome h1 {font-size:20pt;text-align:center;margin:5mm 0;font-weight:700;color:#111;}
.form-editor-body {position:relative;min-height:calc(var(--page-height) - var(--chrome-height));}
.page-guides {position:absolute;inset:0 0 -16px;pointer-events:none;overflow:clip;}
.page-guide {position:absolute;width:100%;border-top:1px dashed #9b5555;color:#804040;font-size:9px;text-align:right;}
.approval-chrome {width:65mm;max-width:100%;font-size:9pt;padding:3mm 0;}
.approval-chrome table {width:100%;border-collapse:collapse;text-align:center;}
.approval-chrome th,.approval-chrome td {border:1px solid #999;padding:2mm;}
.approval-chrome th {background:#f6f6f6;}
.approval-chrome td {height:12mm;}

.form-block-editor-content {outline:none;min-height:100px;}
.form-block-editor-content:focus-visible {outline:2px solid #555;outline-offset:2px;}
.form-block-editor-content .label {overflow-wrap:anywhere;}
.form-block-editor-content button {touch-action:manipulation;}
.form-block-editor-content > div {position:relative;}
.form-block-editor-content .form-blocks.fields {border-top:0;}
.form-block-editor-content .block-settings {border:1px solid #ccc;padding:8px;max-width:100%;overflow-x:auto;}
.form-block-editor-content .block-settings input,.form-block-editor-content .block-settings select {background:#fff;color:#111;}
.form-block-editor-content [data-node-view-content-react] {min-height:1.5em;white-space:pre-wrap;}
.form-block-editor-content .block-columns [data-node-view-content-react] {display:contents;}
.form-block-editor-content .block-column [data-node-view-content-react] {display:block;}
.form-block-editor-content .block-column {border:1px dashed #ccc;padding:2px;}
.form-slash-menu {z-index:60;max-height:280px;overflow-y:auto;width:220px;background:#fff;color:#111;border:1px solid #999;box-shadow:0 4px 12px #0002;padding:4px;color-scheme:light;}
.form-slash-menu button {display:block;text-align:left;width:100%;padding:8px;}
.form-slash-menu button[data-selected=true] {background:#eee;}
.form-drag-handle {cursor:grab;color:#333;background:#fff;border:1px solid #aaa;padding:4px;font-size:20px;}
@media(max-width:640px) {.form-block-drag {display:none!important;}.form-editor-paper {padding:12px;}.form-editor-body {min-height:200px;}.page-guides {display:none;}}
`;
