import { MePage } from "@fmerp/feature-account/ui/components/me-page";
import { TelegramSection } from "@fmerp/feature-notification/ui/components/telegram-section";

export default function Page() {
  return <MePage notifySection={<TelegramSection />} />;
}
