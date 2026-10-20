import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { cn } from "@fmerp/shared/lib/utils";
import { Geist } from "next/font/google";
import { Providers } from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// 홈 화면 설치(standalone) 메타. manifest는 app/manifest.ts가 만든다
export const metadata: Metadata = {
  title: "4mERP",
  description: "전자결재 중심 ERP",
  applicationName: "4mERP",
  appleWebApp: { capable: true, title: "4mERP", statusBarStyle: "default" },
  // Next는 capable을 mobile-web-app-capable로 내보낸다. iOS가 보는 apple- 접두어 메타를 따로 넣는다
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
