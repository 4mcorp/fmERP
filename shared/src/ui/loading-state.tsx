function LoadingState({
  message = "불러오는 중…",
  variant = "page",
}: {
  message?: string;
  variant?: "page" | "inline";
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={
        variant === "page"
          ? "flex min-h-48 items-center justify-center p-6"
          : "flex items-center gap-2 p-2"
      }
      data-slot="loading-state"
      data-variant={variant}
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      <span>{message}</span>
    </div>
  );
}

export { LoadingState };
