import { MePage } from "@fmerp/feature-account/ui/components/me-page";
import { PushSection } from "@fmerp/feature-notification/ui/components/push-section";
import { TelegramSection } from "@fmerp/feature-notification/ui/components/telegram-section";

export default function Page() {
  return (
    <MePage
      notifySection={
        <div className="space-y-4">
          <PushSection />
          <TelegramSection />
        </div>
      }
    />
  );
}
