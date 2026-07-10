'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2, AlertTriangle, Briefcase, Wrench, Bell, Mail, Users } from 'lucide-react';
import { useMaintenanceCategories, useDeleteCategory } from '@/lib/hooks/useMaintenance';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CategoryDialog } from './CategoryDialog';
import { CategoryRecipientsDialog } from './CategoryRecipientsDialog';
import type { MaintenanceCategory } from '@/types/maintenance';
import { formatCategoryPeriod } from '@/lib/utils/maintenancePeriods';
import { getDistanceTypeLabel } from '@/lib/utils/maintenanceCategoryRules';

interface MaintenanceSettingsProps {
  isAdmin: boolean;
  isManager: boolean;
}

export function MaintenanceSettings({ isAdmin, isManager }: MaintenanceSettingsProps) {
  const { data: categoriesData } = useMaintenanceCategories();
  const deleteMutation = useDeleteCategory();
  
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recipientsDialogOpen, setRecipientsDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MaintenanceCategory | null>(null);
  const categories = categoriesData?.categories || [];
  const canModifySettings = isAdmin || isManager;
  
  // Open dialogs
  const openEditDialog = (category: MaintenanceCategory) => {
    setSelectedCategory(category);
    setEditDialogOpen(true);
  };
  
  const openDeleteDialog = (category: MaintenanceCategory) => {
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };

  const openRecipientsDialog = (category: MaintenanceCategory) => {
    setSelectedCategory(category);
    setRecipientsDialogOpen(true);
  };
  
  const handleDelete = async () => {
    if (!selectedCategory) return;
    await deleteMutation.mutateAsync(selectedCategory.id);
    setDeleteDialogOpen(false);
    setSelectedCategory(null);
  };
  
  return (
    <div className="space-y-6">
      {/* Maintenance Categories Header */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Maintenance Categories
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {categories.length} {categories.length === 1 ? 'category' : 'categories'}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setAddDialogOpen(true);
              }}
              className="bg-maintenance hover:bg-maintenance-dark"
              disabled={!canModifySettings}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Category
            </Button>
          </div>
        </CardHeader>
        
          <CardContent className="pt-6">
          {categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No categories configured yet.
            </div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-slate-800/50">
                    <TableHead className="text-muted-foreground">Name</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-muted-foreground">Applies To</TableHead>
                    <TableHead className="text-muted-foreground">Period</TableHead>
                    <TableHead className="text-muted-foreground">Alert Threshold</TableHead>
                    <TableHead className="text-muted-foreground">Responsibility</TableHead>
                    <TableHead className="text-muted-foreground">Reminders</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((category) => (
                      <TableRow
                        key={category.id}
                        className="border-slate-700 hover:bg-slate-800/50"
                      >
                        <TableCell className="font-medium text-white">
                          {category.name}
                        </TableCell>
                        
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {category.type === 'mileage'
                              ? getDistanceTypeLabel(category.applies_to)
                              : category.type}
                          </Badge>
                        </TableCell>
                        
                        <TableCell>
                          <div className="flex gap-1">
                            {category.applies_to?.includes('van') && (
                              <Badge variant="outline" className="text-blue-400 border-blue-400/50 font-mono" title="Applies to vans">
                                V
                              </Badge>
                            )}
                            {category.applies_to?.includes('plant') && (
                              <Badge variant="outline" className="text-purple-400 border-purple-400/50 font-mono" title="Applies to plant machinery">
                                P
                              </Badge>
                            )}
                            {category.applies_to?.includes('hgv') && (
                              <Badge variant="outline" className="text-emerald-400 border-emerald-400/50 font-mono" title="Applies to HGVs">
                                H
                              </Badge>
                            )}
                            {(!category.applies_to || category.applies_to.length === 0) && (
                              <Badge variant="outline" className="text-gray-400 border-gray-400/50">
                                All
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        
                        <TableCell className="text-muted-foreground">
                          {category.type === 'mileage'
                            ? `${category.period_value.toLocaleString()} ${getDistanceTypeLabel(category.applies_to).toLowerCase()}`
                            : formatCategoryPeriod(category)}
                        </TableCell>
                        
                        <TableCell className="text-muted-foreground">
                          {category.type === 'date' 
                            ? `${category.alert_threshold_days} days`
                            : category.type === 'hours'
                            ? `${category.alert_threshold_hours} hours`
                            : `${category.alert_threshold_miles?.toLocaleString()} ${getDistanceTypeLabel(category.applies_to).toLowerCase()}`
                          }
                        </TableCell>
                        
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={category.responsibility === 'office' 
                              ? 'text-brand-yellow border-brand-yellow/50' 
                              : 'text-orange-400 border-orange-400/50'
                            }
                          >
                            {category.responsibility === 'office' ? (
                              <><Briefcase className="h-3 w-3 mr-1" />Office</>
                            ) : (
                              <><Wrench className="h-3 w-3 mr-1" />Workshop</>
                            )}
                          </Badge>
                        </TableCell>
                        
                        <TableCell>
                          <div className="flex gap-1">
                            {category.reminder_in_app_enabled && (
                              <Badge variant="outline" className="text-blue-400 border-blue-400/50" title="In-app notifications enabled">
                                <Bell className="h-3 w-3" />
                              </Badge>
                            )}
                            {category.reminder_email_enabled && (
                              <Badge variant="outline" className="text-green-400 border-green-400/50" title="Email notifications enabled">
                                <Mail className="h-3 w-3" />
                              </Badge>
                            )}
                            {!category.reminder_in_app_enabled && !category.reminder_email_enabled && (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </div>
                        </TableCell>
                        
                        <TableCell>
                          <Badge 
                            variant={category.is_active ? 'default' : 'secondary'}
                            className={category.is_active ? 'bg-green-600' : ''}
                          >
                            {category.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {(category.reminder_in_app_enabled || category.reminder_email_enabled) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openRecipientsDialog(category)}
                                disabled={!canModifySettings}
                                className="text-purple-400 hover:text-purple-300 hover:bg-slate-800 disabled:opacity-30"
                                title="Manage Recipients"
                              >
                                <Users className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(category)}
                              disabled={!canModifySettings}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-30"
                              title="Edit Category"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            {category.is_delete_protected || category.is_system ? (
                              <TooltipProvider delayDuration={150}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled
                                        className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                                        aria-label="Delete disabled for protected category"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    This category is linked to system data and cannot be deleted.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDeleteDialog(category)}
                                disabled={!canModifySettings}
                                className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                                title="Delete Category"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Info Card */}
      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-1">About Maintenance Categories</p>
              <p>
                Categories define what types of maintenance to track. Each category has an alert threshold and can apply to vans, HGVs, plant machinery, or any combination.
              </p>
              <p className="mt-2">
                <strong>Category Types:</strong>
              </p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li><strong>Date-based</strong> (Tax, MOT, LOLER THOROUGH EXAMINATION) - Alert X days before due, with periods in weeks or months</li>
                <li><strong>Distance-based</strong> (Service, Cambelt) - Alert X miles for vans or kilometres for HGVs before due</li>
                <li><strong>Hours-based</strong> (Plant Service) - Alert X engine hours before due</li>
              </ul>
              <p className="mt-2">
                <strong>Applies To:</strong> Categories can apply to vans, HGVs, plant machinery, or combinations. Hours-based categories typically apply to plant machinery since they track engine operating hours.
              </p>
              <div className="mt-2 flex items-center gap-4 text-xs">
                <span className="font-semibold">Key:</span>
                <span className="flex items-center gap-1">
                  <span className="font-mono px-1.5 py-0.5 rounded border border-blue-400/50 text-blue-400">V</span>
                  = Van
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-mono px-1.5 py-0.5 rounded border border-purple-400/50 text-purple-400">P</span>
                  = Plant
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-mono px-1.5 py-0.5 rounded border border-emerald-400/50 text-emerald-400">H</span>
                  = HGV
                </span>
              </div>
              <p className="mt-2">
                <strong>Responsibility:</strong> Workshop categories show &quot;Create Task&quot; button; Office categories show &quot;Office Action&quot; with reminders.
              </p>
              <p className="mt-2">
                <strong>Reminders:</strong> Office categories can send in-app and/or email notifications. Click <Users className="h-3 w-3 inline mx-1" /> to manage recipients.
              </p>
              <p className="mt-2">
                <strong>Note:</strong> Category type and &quot;Applies To&quot; cannot be changed after creation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Add/Edit Category Dialog */}
      <CategoryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        mode="create"
      />
      
      <CategoryDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode="edit"
        category={selectedCategory}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="border-border text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Category
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete this maintenance category? This hides the fleet column while preserving historical values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {selectedCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedCategory.name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Type:</span>{' '}
                <span className="text-white capitalize">{selectedCategory.type}</span>
              </p>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recipients Management Dialog */}
      {selectedCategory && (
        <CategoryRecipientsDialog
          open={recipientsDialogOpen}
          onOpenChange={setRecipientsDialogOpen}
          category={selectedCategory}
        />
      )}
    </div>
  );
}
