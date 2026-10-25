import { SettingsHeader } from "../settings-header";
import { AppearancePicker } from "./appearance-picker";

export default function AppearancePage() {
  return (
    <>
      <SettingsHeader title="Appearance">
        <p>Colors and how your essays read. Kept in this browser, so each device can have its own.</p>
      </SettingsHeader>
      <AppearancePicker />
    </>
  );
}
