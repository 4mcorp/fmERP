import { redirect } from "next/navigation";

/** 문서함 첫 화면은 진행 중 문서 */
export default function MailboxIndexPage() {
  redirect("/mailbox/progress");
}
