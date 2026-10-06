const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

/** 날짜·시간은 Asia/Seoul로 표시한다 (PRD NFR-U05) */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
