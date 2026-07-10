'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Switch } from '@/components/ui/switch';
import { FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import type { FleetInspectionWorkflowConfig } from '@/types/reminders';
import { toast } from 'sonner';

interface FleetInspectionSettingsPanelProps {
  onSaved?: () => void;
}

export function FleetInspectionSettingsPanel({ onSaved }: FleetInspectionSettingsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [config, setConfig] = useState<FleetInspectionWorkflowConfig>({
    overdue_days_threshold: 28,
    asset_types: { van: true, plant: true, hgv: true },
  });

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      try {
        const response = await fetch(`/api/actions/settings/${FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY}`, {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load settings');
        }

        setIsEnabled(payload.settings.is_enabled);
        setConfig(payload.settings.config);
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }

    void loadSettings();
  }, []);

  async function saveSettings(refreshAfterSave: boolean) {
    setSaving(true);
    try {
      const response = await fetch(`/api/actions/settings/${FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_enabled: isEnabled,
          config,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save settings');
      }

      setConfig(payload.settings.config);
      setIsEnabled(payload.settings.is_enabled);

      if (refreshAfterSave) {
        const generateResponse = await fetch('/api/actions/generate-fleet-inspection-reminders', {
          method: 'POST',
        });
        const generatePayload = await generateResponse.json();
        if (!generateResponse.ok) {
          throw new Error(generatePayload.error || 'Settings saved but refresh failed');
        }
      }

      toast.success(refreshAfterSave ? 'Settings saved and actions refreshed' : 'Settings saved');
      onSaved?.();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PanelLoader message="Loading fleet inspection settings..." className="py-12" />;
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle>Fleet inspection reminders</CardTitle>
        <CardDescription>
          Configure when overdue daily check actions are generated for vans, plant, and HGVs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label htmlFor="fleet-inspection-enabled">Workflow enabled</Label>
            <p className="text-sm text-muted-foreground">
              When disabled, open fleet inspection actions are resolved on the next refresh.
            </p>
          </div>
          <Switch
            id="fleet-inspection-enabled"
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="overdue-threshold">Overdue threshold (days)</Label>
          <Input
            id="overdue-threshold"
            type="number"
            min={7}
            max={365}
            value={config.overdue_days_threshold}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              setConfig((current) => ({
                ...current,
                overdue_days_threshold: Number.isFinite(value) ? value : current.overdue_days_threshold,
              }));
            }}
            className="max-w-xs"
          />
          <p className="text-sm text-muted-foreground">
            Assets without a submitted daily check within this period generate an open action.
          </p>
        </div>

        <div className="space-y-3">
          <Label>Asset types</Label>
          {([
            ['van', 'Vans'],
            ['plant', 'Plant'],
            ['hgv', 'HGVs'],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="font-medium text-foreground">{label}</p>
                <p className="text-sm text-muted-foreground">
                  Include {label.toLowerCase()} when generating overdue inspection actions.
                </p>
              </div>
              <Switch
                checked={config.asset_types[key]}
                onCheckedChange={(checked) => {
                  setConfig((current) => ({
                    ...current,
                    asset_types: {
                      ...current.asset_types,
                      [key]: checked,
                    },
                  }));
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => void saveSettings(false)}
            className="gap-2 border-slate-600 text-white hover:bg-slate-800"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save settings
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void saveSettings(true)}
            className="gap-2 bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Save & refresh actions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
