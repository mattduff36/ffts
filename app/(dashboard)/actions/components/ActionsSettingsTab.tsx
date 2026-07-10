import { FleetInspectionSettingsPanel } from './FleetInspectionSettingsPanel';

interface ActionsSettingsTabProps {
  onSaved?: () => void;
}

export function ActionsSettingsTab({ onSaved }: ActionsSettingsTabProps) {
  return <FleetInspectionSettingsPanel onSaved={onSaved} />;
}
