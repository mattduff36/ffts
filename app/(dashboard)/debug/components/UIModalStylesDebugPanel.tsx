'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { modalShowcaseRegistry, type ModalShowcaseEntry } from './modal-styles/modalRegistry';

const STATUS_CLASS: Record<ModalShowcaseEntry['status'], string> = {
  implemented: 'bg-green-500/10 text-green-400 border-green-500/30',
  placeholder: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  'blocked-by-context': 'bg-red-500/10 text-red-400 border-red-500/30',
};
const PRIMARY_CTA_CLASS = 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold';

export function UIModalStylesDebugPanel() {
  const [query, setQuery] = useState('');
  const [activeModalId, setActiveModalId] = useState<string | null>(null);
  const [isCycling, setIsCycling] = useState(false);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [variantByModal, setVariantByModal] = useState<Record<string, string>>(() => {
    return Object.fromEntries(
      modalShowcaseRegistry.map((entry) => [entry.id, entry.variants[0]?.id ?? 'default'])
    );
  });

  const groupedEntries = useMemo(() => {
    const filtered = modalShowcaseRegistry.filter((entry) => {
      const term = query.trim().toLowerCase();
      if (!term) return true;
      return (
        entry.label.toLowerCase().includes(term) ||
        entry.feature.toLowerCase().includes(term) ||
        entry.sourcePath.toLowerCase().includes(term)
      );
    });

    return filtered.reduce<Record<string, ModalShowcaseEntry[]>>((acc, entry) => {
      acc[entry.feature] ??= [];
      acc[entry.feature].push(entry);
      return acc;
    }, {});
  }, [query]);

  const visibleEntries = useMemo(() => {
    return Object.values(groupedEntries).flat();
  }, [groupedEntries]);

  const activeEntry = modalShowcaseRegistry.find((entry) => entry.id === activeModalId) ?? null;
  const activeVariant = activeEntry ? variantByModal[activeEntry.id] ?? activeEntry.variants[0].id : 'default';

  function updateVariant(modalId: string, value: string) {
    setVariantByModal((prev) => ({ ...prev, [modalId]: value }));
  }

  function startCycle() {
    if (visibleEntries.length === 0) return;
    setIsCycling(true);
    setCycleIndex(0);
    setActiveModalId(visibleEntries[0].id);
  }

  function stopCycle() {
    setIsCycling(false);
    setCycleIndex(0);
    setActiveModalId(null);
  }

  useEffect(() => {
    if (!isCycling || visibleEntries.length === 0) return;
    if (cycleIndex >= visibleEntries.length) {
      setIsCycling(false);
      setActiveModalId(null);
      return;
    }
    const entry = visibleEntries[cycleIndex];
    setActiveModalId(entry.id);
    const timer = window.setTimeout(() => {
      setCycleIndex((prev) => prev + 1);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isCycling, cycleIndex, visibleEntries]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>UI Modal Styles Lab</CardTitle>
          <CardDescription>
            Open each modal in safe demo mode and test styling variants before global rollout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-semibold">{modalShowcaseRegistry.length}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Implemented</p>
              <p className="text-2xl font-semibold">
                {modalShowcaseRegistry.filter((entry) => entry.status === 'implemented').length}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Placeholders</p>
              <p className="text-2xl font-semibold">
                {
                  modalShowcaseRegistry.filter(
                    (entry) => entry.status === 'placeholder' || entry.status === 'blocked-by-context'
                  ).length
                }
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Current Search</p>
              <p className="text-sm font-medium truncate">{query.trim() || 'All modals'}</p>
            </div>
          </div>

          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by modal name, feature, or source path..."
          />
          <div className="flex flex-wrap gap-2">
            <Button className={PRIMARY_CTA_CLASS} onClick={startCycle} disabled={isCycling || visibleEntries.length === 0}>
              Open All (4s each)
            </Button>
            <Button className={PRIMARY_CTA_CLASS} onClick={stopCycle} disabled={!isCycling}>
              Stop
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.entries(groupedEntries)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([feature, entries]) => (
          <Card key={feature}>
            <CardHeader>
              <CardTitle className="text-lg">{feature}</CardTitle>
              <CardDescription>{entries.length} modal entries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {entries.map((entry) => {
                const selectedVariantId = variantByModal[entry.id] ?? entry.variants[0].id;
                return (
                  <div key={entry.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{entry.label}</p>
                          <Badge variant="outline" className={STATUS_CLASS[entry.status]}>
                            {entry.status}
                          </Badge>
                          <Badge variant="secondary">{entry.kind}</Badge>
                        </div>
                        <p className="break-all text-xs text-muted-foreground">{entry.sourcePath}</p>
                        {entry.notes && <p className="break-words text-xs text-muted-foreground">{entry.notes}</p>}
                      </div>
                      <div className="flex w-full shrink-0 flex-col gap-2 md:w-auto md:flex-row">
                        <Select
                          value={selectedVariantId}
                          onValueChange={(value) => updateVariant(entry.id, value)}
                        >
                          <SelectTrigger className="w-full md:w-[220px]">
                            <SelectValue placeholder="Select variant" />
                          </SelectTrigger>
                          <SelectContent>
                            {entry.variants.map((variant) => (
                              <SelectItem key={variant.id} value={variant.id}>
                                {variant.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button className={PRIMARY_CTA_CLASS} onClick={() => setActiveModalId(entry.id)}>
                          Open Modal
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}

      {activeEntry
        ? activeEntry.render({
            open: true,
            onOpenChange: (open) => {
              if (!open) {
                setActiveModalId(null);
              }
            },
            variantId: activeVariant,
          })
        : null}
    </div>
  );
}
