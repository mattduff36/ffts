'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Boxes, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import type { InventoryItemCategory, InventoryItemCategoryFormData } from '../types';

interface InventoryCategoriesPanelProps {
  categories: InventoryItemCategory[];
  onCreate: (data: InventoryItemCategoryFormData) => Promise<void>;
  onUpdate: (category: InventoryItemCategory, data: InventoryItemCategoryFormData) => Promise<void>;
  onRemove: (category: InventoryItemCategory) => Promise<void>;
}

const emptyForm: InventoryItemCategoryFormData = {
  name: '',
  slug: '',
  description: '',
  sort_order: '',
};

function slugifyCategoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function InventoryCategoriesPanel({
  categories,
  onCreate,
  onUpdate,
  onRemove,
}: InventoryCategoriesPanelProps) {
  const [form, setForm] = useState<InventoryItemCategoryFormData>(emptyForm);
  const [editingCategory, setEditingCategory] = useState<InventoryItemCategory | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingCategory) {
      setForm(emptyForm);
      return;
    }

    setForm({
      name: editingCategory.name,
      slug: editingCategory.slug,
      description: editingCategory.description || '',
      sort_order: String(editingCategory.sort_order),
    });
  }, [editingCategory]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  function updateName(name: string) {
    setForm((current) => ({
      ...current,
      name,
      slug: editingCategory ? current.slug : slugifyCategoryName(name),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setIsSaving(true);
    try {
      if (editingCategory) await onUpdate(editingCategory, form);
      else await onCreate(form);
      setEditingCategory(null);
      setForm(emptyForm);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Tags className="h-5 w-5 text-inventory" />
            Item Categories
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedCategories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No inventory categories have been created yet.</p>
          ) : (
            sortedCategories.map((category) => (
              <div key={category.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-white">{category.name}</div>
                    <Badge variant="outline" className="mt-3 border-slate-600 text-slate-200">
                      <Boxes className="mr-1 h-3 w-3" />
                      {category.item_count || 0} item{category.item_count === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingCategory(category)} className="border-slate-600">
                      <Pencil className="mr-2 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => onRemove(category)}
                      disabled={(category.item_count || 0) > 0}
                      title={(category.item_count || 0) > 0 ? 'Move items to another category before deleting' : 'Delete category'}
                      aria-label={`Delete ${category.name}`}
                      className="border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Plus className="h-5 w-5 text-inventory" />
            {editingCategory ? 'Edit Category' : 'Create Category'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="category_name">Category Name *</Label>
              <Input
                id="category_name"
                value={form.name}
                onChange={(event) => updateName(event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={isSaving || !form.name.trim()}>
                {editingCategory ? 'Save Category' : 'Create Category'}
              </Button>
              {editingCategory ? (
                <Button type="button" variant="outline" onClick={() => setEditingCategory(null)} disabled={isSaving}>
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
