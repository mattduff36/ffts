'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Save, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Database } from '@/types/database';

type Template = Database['public']['Tables']['workshop_attachment_templates']['Row'];

interface SchemaFieldDraft {
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
}

interface SchemaSectionDraft {
  section_key: string;
  title: string;
  description: string;
  fields: SchemaFieldDraft[];
}

interface AttachmentSchemaBuilderPanelProps {
  templateId: string;
  templateName: string;
  templates: Template[];
}

interface TemplateSchemaPayload {
  sections: SchemaSectionDraft[];
  version: { id: string; version_number: number; status: string } | null;
}

function toKey(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 110);
  if (!normalized) return fallback;
  return normalized;
}

export function AttachmentSchemaBuilderPanel({
  templateId,
  templateName,
  templates,
}: AttachmentSchemaBuilderPanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<SchemaSectionDraft[]>([]);
  const [versionLabel, setVersionLabel] = useState<string>('No schema version');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [cloneTemplateId, setCloneTemplateId] = useState<string>('');

  const cloneOptions = useMemo(
    () => templates.filter((template) => template.id !== templateId),
    [templates, templateId],
  );

  async function fetchSchema() {
    setLoading(true);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/templates/${templateId}/schema`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load schema');

      const payload = data as {
        sections?: Array<{
          section_key: string;
          title: string;
          description: string | null;
          fields: Array<{
            field_key: string;
            label: string;
            field_type: SchemaFieldDraft['field_type'];
            is_required: boolean;
          }>;
        }>;
        version?: { version_number: number; status: string } | null;
      };

      const nextSections = (payload.sections || []).map((section) => ({
        section_key: section.section_key,
        title: section.title,
        description: section.description || '',
        fields: (section.fields || []).map((field) => ({
          label: field.label,
          field_type: field.field_type,
          is_required: Boolean(field.is_required),
        })),
      }));
      setSections(nextSections);
      if (payload.version) {
        setVersionLabel(`v${payload.version.version_number} (${payload.version.status})`);
      } else {
        setVersionLabel('No schema version');
      }
    } catch (error) {
      console.error('Failed to load template schema:', error);
      toast.error('Failed to load schema');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  function addSection() {
    const title = newSectionTitle.trim();
    if (!title) {
      toast.error('Section title is required');
      return;
    }
    const sectionIndex = sections.length + 1;
    const sectionKey = toKey(title, `section_${sectionIndex}`);
    setSections((prev) => [
      ...prev,
      {
        section_key: sectionKey,
        title,
        description: '',
        fields: [],
      },
    ]);
    setNewSectionTitle('');
  }

  function addField(sectionIndex: number) {
    setSections((prev) => prev.map((section, idx) => {
      if (idx !== sectionIndex) return section;
      return {
        ...section,
        fields: [
          ...section.fields,
          {
            label: '',
            field_type: 'text',
            is_required: false,
          },
        ],
      };
    }));
  }

  async function saveSchema() {
    if (sections.length === 0) {
      toast.error('Add at least one section');
      return;
    }

    if (sections.some((section) => section.fields.length === 0)) {
      toast.error('Each section must include at least one field');
      return;
    }

    if (sections.some((section) => section.fields.some((field) => !field.label.trim()))) {
      toast.error('Every field requires a label');
      return;
    }

    setSaving(true);
    try {
      const payload: TemplateSchemaPayload = {
        sections: sections.map((section, sectionIndex) => ({
          section_key: section.section_key || toKey(section.title, `section_${sectionIndex + 1}`),
          title: section.title.trim() || `Section ${sectionIndex + 1}`,
          description: section.description.trim(),
          fields: section.fields.map((field, fieldIndex) => ({
            field_key: toKey(field.label, `field_${fieldIndex + 1}`),
            label: field.label.trim(),
            field_type: field.field_type,
            is_required: field.is_required,
          })),
        })),
        version: null,
      };

      const response = await fetch(`/api/workshop-tasks/attachments/templates/${templateId}/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections: payload.sections,
          status: 'published',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save schema');
      toast.success('Schema version published');
      await fetchSchema();
    } catch (error) {
      console.error('Failed to save template schema:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save schema');
    } finally {
      setSaving(false);
    }
  }

  async function cloneSchema() {
    if (!cloneTemplateId) {
      toast.error('Select a source template to clone from');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/templates/${templateId}/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clone_from_template_id: cloneTemplateId,
          status: 'published',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Failed to clone schema');
        return;
      }
      toast.success('Schema cloned into new version');
      await fetchSchema();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clone schema');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-white">Section Builder (V2)</CardTitle>
        <CardDescription className="text-muted-foreground">
          {templateName} - {versionLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cloneTemplate">Clone from template</Label>
            <Select value={cloneTemplateId} onValueChange={setCloneTemplateId}>
              <SelectTrigger id="cloneTemplate">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {cloneOptions.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { void cloneSchema(); }}
              disabled={saving || !cloneTemplateId}
            >
              <Copy className="h-4 w-4 mr-2" />
              Clone Schema
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-2">
            <Label htmlFor="newSectionTitle">Add section</Label>
            <div className="flex items-center gap-2">
              <Input
                id="newSectionTitle"
                value={newSectionTitle}
                onChange={(event) => setNewSectionTitle(event.target.value)}
                placeholder="e.g. Inside Cab"
              />
              <Button type="button" onClick={addSection}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <PanelLoader message="Loading schema..." accent="workshop" className="py-6" />
        ) : (
          <div className="space-y-4">
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sections yet. Create your first section or clone from another V2 template.
              </p>
            ) : (
              sections.map((section, sectionIndex) => (
                <div
                  key={`${section.section_key}_${sectionIndex}`}
                  className="rounded-lg border border-[hsl(var(--workshop-primary)/0.3)] bg-[hsl(var(--workshop-primary)/0.08)] p-4 space-y-3"
                >
                  <div className="space-y-1 rounded-md border border-border bg-[hsl(var(--card))] p-3">
                    <Label>Section title</Label>
                    <Input
                      value={section.title}
                      onChange={(event) => setSections((prev) => prev.map((entry, idx) => (
                        idx === sectionIndex ? { ...entry, title: event.target.value } : entry
                      )))}
                    />
                  </div>
                  <div className="space-y-1 rounded-md border border-border bg-[hsl(var(--card))] p-3">
                    <Label>Description</Label>
                    <Textarea
                      value={section.description}
                      onChange={(event) => setSections((prev) => prev.map((entry, idx) => (
                        idx === sectionIndex ? { ...entry, description: event.target.value } : entry
                      )))}
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2 rounded-md border border-border bg-[hsl(var(--card))] p-3">
                    <div className="flex items-center justify-between">
                      <Label>Fields</Label>
                      <Button type="button" variant="outline" onClick={() => addField(sectionIndex)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Field
                      </Button>
                    </div>
                    {section.fields.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No fields in this section.</p>
                    ) : (
                      section.fields.map((field, fieldIndex) => (
                        <div key={`${field.label}_${fieldIndex}`} className="grid grid-cols-1 gap-2 rounded-md border border-border bg-[hsl(var(--card))] p-3 md:grid-cols-3">
                          <Input
                            value={field.label}
                            onChange={(event) => setSections((prev) => prev.map((entry, idx) => {
                              if (idx !== sectionIndex) return entry;
                              return {
                                ...entry,
                                fields: entry.fields.map((fieldEntry, fieldIdx) => (
                                  fieldIdx === fieldIndex
                                    ? { ...fieldEntry, label: event.target.value }
                                    : fieldEntry
                                )),
                              };
                            }))}
                            placeholder="Field label"
                          />
                          <Select
                            value={field.field_type}
                            onValueChange={(value) => setSections((prev) => prev.map((entry, idx) => {
                              if (idx !== sectionIndex) return entry;
                              return {
                                ...entry,
                                fields: entry.fields.map((fieldEntry, fieldIdx) => (
                                  fieldIdx === fieldIndex
                                    ? { ...fieldEntry, field_type: value as SchemaFieldDraft['field_type'] }
                                    : fieldEntry
                                )),
                              };
                            }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="marking_code">Marking Code</SelectItem>
                              <SelectItem value="yes_no">Yes/No</SelectItem>
                              <SelectItem value="text">Text</SelectItem>
                              <SelectItem value="long_text">Long Text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="signature">Signature</SelectItem>
                            </SelectContent>
                          </Select>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={field.is_required}
                              onChange={(event) => setSections((prev) => prev.map((entry, idx) => {
                                if (idx !== sectionIndex) return entry;
                                return {
                                  ...entry,
                                  fields: entry.fields.map((fieldEntry, fieldIdx) => (
                                    fieldIdx === fieldIndex
                                      ? { ...fieldEntry, is_required: event.target.checked }
                                      : fieldEntry
                                  )),
                                };
                              }))}
                            />
                            Required
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            onClick={() => { void saveSchema(); }}
            disabled={saving || sections.length === 0}
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Publish Schema Version'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
