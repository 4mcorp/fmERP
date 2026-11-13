import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { RichTextGuard } from "./rich-text-guard";

export const richTextExtensions = [
  RichTextGuard,
  StarterKit,
  Table,
  TableRow,
  TableHeader,
  TableCell,
];
