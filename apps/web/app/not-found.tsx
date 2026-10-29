import Link from "next/link";

/** 없는 주소로 들어왔을 때의 404 화면 */
export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="text-sm text-muted-foreground">주소가 잘못되었거나 페이지가 옮겨졌습니다.</p>
      <Link href="/" className="text-sm underline underline-offset-4">
        홈으로 이동
      </Link>
    </div>
  );
}
