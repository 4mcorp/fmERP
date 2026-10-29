import { Button } from "./button";

function QueryErrorState({
  message = "데이터를 불러오지 못했습니다",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 p-6 text-center"
      data-slot="query-error-state"
      role="alert"
    >
      <p>{message}</p>
      <Button onClick={onRetry} type="button" variant="outline">
        다시 시도
      </Button>
    </div>
  );
}

export { QueryErrorState };
