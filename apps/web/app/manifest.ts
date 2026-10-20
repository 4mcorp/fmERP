import type { MetadataRoute } from "next";

// 홈 화면 설치(standalone) 정보. 아이콘은 public/icons에 저장소 안에서 만든 파일이다 (외부 다운로드 없음).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "4mERP",
    short_name: "4mERP",
    description: "전자결재 중심 ERP",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ko",
    theme_color: "#1d4ed8",
    background_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
