import { RunnerSettingsForm } from "./RunnerSettingsForm";
import { UtilitySettingsForm } from "./UtilitySettingsForm";
import { ChatSettingsForm } from "./ChatSettingsForm";
import { GlobalConstitutionForm } from "./GlobalConstitutionForm";

export default function SettingsPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <RunnerSettingsForm />
      <UtilitySettingsForm />
      <GlobalConstitutionForm />
      <ChatSettingsForm />
    </main>
  );
}
