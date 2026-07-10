'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, Edit, FileText, HardHat, Plus, Trash2, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { AttachmentSchemaBuilderPanel } from './AttachmentSchemaBuilderPanel';

type Template = Database['public']['Tables']['workshop_attachment_templates']['Row'];

interface AttachmentManagementPanelProps {
  taxonomyMode?: 'van' | 'plant' | 'hgv';
}

function normalizeTemplateAppliesTo(rawValues?: string[] | null): string[] {
  const normalized = (rawValues || [])
    .map((value) => value.trim().toLowerCase())
    .map((value) => (value === 'vehicle' ? 'van' : value))
    .filter(Boolean);

  if (normalized.length === 0) return ['van', 'hgv', 'plant'];
  return Array.from(new Set(normalized));
}

export function AttachmentManagementPanel({ taxonomyMode }: AttachmentManagementPanelProps) {
  const supabase = createClient();
  const { tabletModeEnabled } = useTabletMode();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateActive, setTemplateActive] = useState(true);
  const [templateAppliesToVehicle, setTemplateAppliesToVehicle] = useState(true);
  const [templateAppliesToHgv, setTemplateAppliesToHgv] = useState(true);
  const [templateAppliesToPlant, setTemplateAppliesToPlant] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const templateDialogRef = useRef<HTMLDivElement>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_attachment_templates')
        .select('*')
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      toast.error('Failed to load attachment templates');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filteredTemplates = useMemo(() => (
    taxonomyMode
      ? templates.filter((template) =>
          normalizeTemplateAppliesTo(template.applies_to).includes(taxonomyMode),
        )
      : templates
  ), [taxonomyMode, templates]);

  useEffect(() => {
    if (!selectedTemplateId && filteredTemplates.length > 0) {
      setSelectedTemplateId(filteredTemplates[0].id);
      return;
    }

    if (selectedTemplateId && !filteredTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(filteredTemplates[0]?.id || null);
    }
  }, [filteredTemplates, selectedTemplateId]);

  const selectedTemplate = filteredTemplates.find((template) => template.id === selectedTemplateId) || null;

  const isTemplateDirty = useMemo(() => {
    const originalName = editingTemplate?.name || '';
    const originalDescription = editingTemplate?.description || '';
    const originalActive = editingTemplate?.is_active ?? true;
    const originalAppliesTo = normalizeTemplateAppliesTo(editingTemplate?.applies_to);

    return (
      templateName.trim() !== originalName.trim()
      || templateDescription.trim() !== originalDescription.trim()
      || templateActive !== originalActive
      || templateAppliesToVehicle !== originalAppliesTo.includes('van')
      || templateAppliesToHgv !== originalAppliesTo.includes('hgv')
      || templateAppliesToPlant !== originalAppliesTo.includes('plant')
    );
  }, [
    editingTemplate,
    templateActive,
    templateAppliesToHgv,
    templateAppliesToPlant,
    templateAppliesToVehicle,
    templateDescription,
    templateName,
  ]);

  function resetTemplateDialogForCreate() {
    setEditingTemplate(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateActive(true);
    setTemplateAppliesToVehicle(true);
    setTemplateAppliesToHgv(true);
    setTemplateAppliesToPlant(true);
    setShowTemplateDialog(true);
  }

  function resetTemplateDialogForEdit(template: Template) {
    const appliesTo = normalizeTemplateAppliesTo(template.applies_to);
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description || '');
    setTemplateActive(template.is_active ?? true);
    setTemplateAppliesToVehicle(appliesTo.includes('van'));
    setTemplateAppliesToHgv(appliesTo.includes('hgv'));
    setTemplateAppliesToPlant(appliesTo.includes('plant'));
    setShowTemplateDialog(true);
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) {
      toast.error('Template name is required');
      return;
    }

    if (!templateAppliesToVehicle && !templateAppliesToHgv && !templateAppliesToPlant) {
      toast.error('Template must apply to at least one asset type');
      return;
    }

    setSavingTemplate(true);
    try {
      const appliesTo: string[] = [];
      if (templateAppliesToVehicle) appliesTo.push('van');
      if (templateAppliesToHgv) appliesTo.push('hgv');
      if (templateAppliesToPlant) appliesTo.push('plant');

      if (editingTemplate) {
        const { error } = await supabase
          .from('workshop_attachment_templates')
          .update({
            name: templateName.trim(),
            description: templateDescription.trim() || null,
            is_active: templateActive,
            applies_to: appliesTo,
          })
          .eq('id', editingTemplate.id);
        if (error) throw error;
        toast.success('Template updated');
      } else {
        const { error } = await supabase
          .from('workshop_attachment_templates')
          .insert({
            name: templateName.trim(),
            description: templateDescription.trim() || null,
            is_active: templateActive,
            applies_to: appliesTo,
          });
        if (error) throw error;
        toast.success('Template created');
      }

      setShowTemplateDialog(false);
      await fetchTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!deleteTemplateId) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('workshop_attachment_templates')
        .delete()
        .eq('id', deleteTemplateId);
      if (error) throw error;
      toast.success('Template deleted');
      setDeleteTemplateId(null);
      await fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card className="border-border">
        <CardHeader
          className="cursor-pointer hover:bg-slate-800/30 transition-colors"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              <div>
                <CardTitle className="text-white">Attachment Templates</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {loading
                    ? 'Loading...'
                    : `${filteredTemplates.length} ${filteredTemplates.length === 1 ? 'template' : 'templates'} • V2 schema builder`}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                resetTemplateDialogForCreate();
              }}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="pt-6">
            {loading ? (
              <PanelLoader message="Loading attachment templates..." accent="workshop" className="py-12" />
            ) : filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No Templates Yet</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Create a template, then configure sections and fields using the V2 schema builder.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">
                    Templates ({filteredTemplates.length})
                  </p>
                  {filteredTemplates.map((template) => {
                    const isSelected = selectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-workshop/10 border-workshop'
                            : 'bg-muted/30 border-border hover:border-border/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`font-medium truncate ${isSelected ? 'text-workshop' : 'text-foreground'}`}>
                                {template.name}
                              </p>
                              {!template.is_active && (
                                <Badge variant="outline" className="text-xs bg-muted">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-4">
                  {selectedTemplate ? (
                    <>
                      <div className="flex items-start justify-between pb-4 border-b border-border">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-xl font-semibold text-foreground">{selectedTemplate.name}</h3>
                            {!selectedTemplate.is_active && (
                              <Badge variant="outline" className="bg-muted">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          {selectedTemplate.description && (
                            <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                            {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('van') && (
                              <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" /> Van</span>
                            )}
                            {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('hgv') && (
                              <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" /> HGV</span>
                            )}
                            {normalizeTemplateAppliesTo(selectedTemplate.applies_to).includes('plant') && (
                              <span className="inline-flex items-center gap-1"><HardHat className="h-3 w-3" /> Plant</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resetTemplateDialogForEdit(selectedTemplate)}
                            className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteTemplateId(selectedTemplate.id)}
                            className={`${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''} border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>

                      <AttachmentSchemaBuilderPanel
                        templateId={selectedTemplate.id}
                        templateName={selectedTemplate.name}
                        templates={templates}
                      />
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Select a template from the list to manage its schema.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog
        open={showTemplateDialog}
        onOpenChange={(open) => {
          if (!open && !savingTemplate && isTemplateDirty) {
            triggerShakeAnimation(templateDialogRef.current);
            return;
          }
          setShowTemplateDialog(open);
        }}
      >
        <DialogContent
          ref={templateDialogRef}
          className={tabletModeEnabled ? 'p-5 sm:p-6' : undefined}
          onInteractOutside={(event) => {
            if (!savingTemplate && isTemplateDirty) {
              event.preventDefault();
              triggerShakeAnimation(templateDialogRef.current);
            }
          }}
          onEscapeKeyDown={(event) => {
            if (!savingTemplate && isTemplateDirty) {
              event.preventDefault();
              triggerShakeAnimation(templateDialogRef.current);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create Template'}</DialogTitle>
            <DialogDescription>
              {editingTemplate ? 'Update template details' : 'Create a new attachment template'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="templateName">
                Template Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="templateName"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="e.g., Full Service Checklist"
                className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="templateDescription">Description</Label>
              <Textarea
                id="templateDescription"
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                placeholder="Optional description"
                rows={3}
                className={tabletModeEnabled ? 'text-base' : undefined}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="templateActive">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive templates will not be available for new tasks.
                </p>
              </div>
              <Switch id="templateActive" checked={templateActive} onCheckedChange={setTemplateActive} />
            </div>

            <div className="space-y-3">
              <Label>Applies To <span className="text-red-500">*</span></Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-van"
                    checked={templateAppliesToVehicle}
                    onCheckedChange={(checked) => setTemplateAppliesToVehicle(Boolean(checked))}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-van" className="cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-400" />
                    Van Tasks
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-hgv"
                    checked={templateAppliesToHgv}
                    onCheckedChange={(checked) => setTemplateAppliesToHgv(Boolean(checked))}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-hgv" className="cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-cyan-400" />
                    HGV Tasks
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="template-applies-plant"
                    checked={templateAppliesToPlant}
                    onCheckedChange={(checked) => setTemplateAppliesToPlant(Boolean(checked))}
                    className="border-slate-600"
                  />
                  <Label htmlFor="template-applies-plant" className="cursor-pointer flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-orange-400" />
                    Plant Tasks
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button
              variant="outline"
              onClick={() => setShowTemplateDialog(false)}
              className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
            >
              {isTemplateDirty ? 'Discard Changes' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !templateName.trim()}
              className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {savingTemplate ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTemplateId)} onOpenChange={(open) => !open && setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the template and all V2 schema versions.
              Existing task attachments retain their immutable schema snapshots.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTemplate}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
