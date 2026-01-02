import { RunnerSettingsForm } from "./RunnerSettingsForm";
import { ChatSettingsForm } from "./ChatSettingsForm";

export default function SettingsPage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <RunnerSettingsForm />
      <ChatSettingsForm />
    </main>
  );
}
