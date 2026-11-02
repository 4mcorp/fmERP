import { createElement, type ReactNode } from "react";
import { FORM_BLOCK_CSS, FORM_BLOCK_FONT_CSS } from "../domain/form-block-style";
import { type BlockContext, type BlockMode, renderBlocks } from "../domain/form-blocks";
import { type FormLayout, resolveBlocks } from "../domain/form-layout";
import type { FormField, FormSchema } from "../domain/form-schema";

/** 필드 위젯은 소비 화면이 주입한다. 편집기·작성 화면 연결은 각 단계에서 한다. */
export function FormBlocks(props: {
  schema: FormSchema;
  layout: FormLayout;
  mode: BlockMode;
  renderField(field: FormField, context: BlockContext): ReactNode;
  renderLabel?(field: FormField, context: BlockContext): ReactNode;
  renderText?(text: string): ReactNode;
  includeStyles?: boolean;
}) {
  const body = renderBlocks<ReactNode>({
    fields: props.schema.fields,
    blocks: resolveBlocks(props.schema, props.layout),
    legacy: props.layout.blocks === undefined,
    mode: props.mode,
    adapter: {
      text: props.renderText ?? ((text) => text),
      element: (tag, { class: className, ...attrs }, children) =>
        createElement(tag, { className, ...attrs }, ...children),
      field: props.renderField,
      label: props.renderLabel,
    },
  });
  return (
    <>
      {props.includeStyles === false ? null : <style>{FORM_BLOCK_FONT_CSS + FORM_BLOCK_CSS}</style>}
      {body}
    </>
  );
}
