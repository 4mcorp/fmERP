import { MePage } from "@/components/me/me-page";
import { TelegramSection } from "@/components/me/telegram-section";

export default function Page() {
  return <MePage notifySection={<TelegramSection />} />;
}
