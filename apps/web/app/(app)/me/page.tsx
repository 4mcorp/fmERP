import { TelegramSection } from "@fmerp/feature-notification/ui/components/telegram-section";
import { MePage } from "@/components/me/me-page";

export default function Page() {
  return <MePage notifySection={<TelegramSection />} />;
}
