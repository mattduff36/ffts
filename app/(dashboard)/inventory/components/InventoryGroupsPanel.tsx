'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PackagePlus, Pencil, Trash2, Users } from 'lucide-react';
import type { InventoryItem, InventoryItemGroup } from '../types';

interface InventoryGroupFormData {
  name: string;
  description: string;
  item_ids: string[];
}

interface InventoryGroupsPanelProps {
  groups: InventoryItemGroup[];
  items: InventoryItem[];
  onCreate: (data: InventoryGroupFormData) => Promise<void>;
  onUpdate: (group: InventoryItemGroup, data: InventoryGroupFormData) => Promise<void>;
  onRemove: (group: InventoryItemGroup) => Promise<void>;
}

const emptyForm: InventoryGroupFormData = {
  name: '',
  description: '',
  item_ids: [],
};

export function InventoryGroupsPanel({
  groups,
  items,
  onCreate,
  onUpdate,
  onRemove,
}: InventoryGroupsPanelProps) {
  const [form, setForm] = useState<InventoryGroupFormData>(emptyForm);
  const [editingGroup, setEditingGroup] = useState<InventoryItemGroup | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!editingGroup) {
      setForm(emptyForm);
      return;
    }

    setForm({
      name: editingGroup.name,
      description: editingGroup.description || '',
      item_ids: (editingGroup.members || []).map((member) => member.item_id),
    });
  }, [editingGroup]);

  const groupedItemIds = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach((group) => {
      if (editingGroup?.id === group.id) return;
      (group.members || []).forEach((member) => ids.add(member.item_id));
    });
    return ids;
  }, [editingGroup?.id, groups]);

  const selectableItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => item.status === 'active')
      .filter((item) => !groupedItemIds.has(item.id))
      .filter((item) => {
        if (!query) return true;
        return (
          item.name.toLowerCase().includes(query) ||
          item.item_number.toLowerCase().includes(query) ||
          (item.location?.name || '').toLowerCase().includes(query)
        );
      })
      .slice(0, 80);
  }, [groupedItemIds, items, search]);

  function toggleItem(itemId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      item_ids: checked
        ? Array.from(new Set([...current.item_ids, itemId]))
        : current.item_ids.filter((id) => id !== itemId),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setIsSaving(true);
    try {
      if (editingGroup) await onUpdate(editingGroup, form);
      else await onCreate(form);
      setEditingGroup(null);
      setForm(emptyForm);
      setSearch('');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Users className="h-5 w-5 text-inventory" />
            Inventory Groups
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No inventory groups have been created yet.</p>
          ) : (
            groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-white">{group.name}</div>
                    {group.description ? <p className="mt-1 text-sm text-muted-foreground">{group.description}</p> : null}
                    <Badge variant="outline" className="mt-2 border-purple-500/30 bg-purple-500/10 text-purple-200">
                      {(group.members || []).length} item{(group.members || []).length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingGroup(group)}>
                      <Pencil className="mr-2 h-3 w-3" />
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" className="border-red-500/30 text-red-300 hover:bg-red-500/10" onClick={() => onRemove(group)}>
                      <Trash2 className="mr-2 h-3 w-3" />
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(group.members || []).map((member) => (
                    <Badge key={member.id} variant="outline" className="border-slate-600 text-slate-200">
                      {member.item?.item_number || member.item_id} · {member.item?.name || 'Inventory item'}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <PackagePlus className="h-5 w-5 text-inventory" />
            {editingGroup ? 'Edit Group' : 'Create Group'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="group_name">Group Name *</Label>
              <Input
                id="group_name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="bg-slate-800 border-slate-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_description">Description</Label>
              <Textarea
                id="group_description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="bg-slate-800 border-slate-600"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Items</Label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search items"
                className="bg-slate-800 border-slate-600"
              />
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-700 p-2">
                {selectableItems.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-800">
                    <Checkbox
                      checked={form.item_ids.includes(item.id)}
                      onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
                    />
                    <span>
                      <span className="block font-medium text-white">{item.name}</span>
                      <span className="text-xs text-muted-foreground">{item.item_number} · {item.location?.name || 'No location assigned'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={isSaving || !form.name.trim()}>
                {editingGroup ? 'Save Group' : 'Create Group'}
              </Button>
              {editingGroup ? (
                <Button type="button" variant="outline" onClick={() => setEditingGroup(null)} disabled={isSaving}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
