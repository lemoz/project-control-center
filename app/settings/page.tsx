import { RunnerSettingsForm } from "./RunnerSettingsForm";
import { AgentMonitoringSettingsForm } from "./AgentMonitoringSettingsForm";
import { NetworkWhitelistSettingsForm } from "./NetworkWhitelistSettingsForm";
import { ShiftSchedulerSettingsForm } from "./ShiftSchedulerSettingsForm";
import { UtilitySettingsForm } from "./UtilitySettingsForm";
import { ChatSettingsForm } from "./ChatSettingsForm";
import { GlobalConstitutionForm } from "./GlobalConstitutionForm";

export default function SettingsPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <RunnerSettingsForm />
      <AgentMonitoringSettingsForm />
      <NetworkWhitelistSettingsForm />
      <ShiftSchedulerSettingsForm />
      <UtilitySettingsForm />
      <GlobalConstitutionForm />
      <ChatSettingsForm />
    </main>
  );
}
