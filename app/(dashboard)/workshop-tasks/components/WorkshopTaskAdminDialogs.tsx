import { useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import type { Action, Category } from '../types';

interface WorkshopTaskAdminDialogsProps {
  showSettings: boolean;
  showCategoryModal: boolean;
  onShowCategoryModalChange: (open: boolean) => void;
  editingCategory: Category | null;
  categoryName: string;
  onCategoryNameChange: (value: string) => void;
  submittingCategory: boolean;
  onSaveCategory: () => void;
  onResetCategoryForm: () => void;
  showDeleteConfirm: boolean;
  onShowDeleteConfirmChange: (open: boolean) => void;
  taskToDelete: Action | null;
  getVehicleReg: (task: Action) => string;
  deleting: boolean;
  onConfirmDeleteTask: () => void;
  onResetDeleteTask: () => void;
}

export function WorkshopTaskAdminDialogs({
  showSettings,
  showCategoryModal,
  onShowCategoryModalChange,
  editingCategory,
  categoryName,
  onCategoryNameChange,
  submittingCategory,
  onSaveCategory,
  onResetCategoryForm,
  showDeleteConfirm,
  onShowDeleteConfirmChange,
  taskToDelete,
  getVehicleReg,
  deleting,
  onConfirmDeleteTask,
  onResetDeleteTask,
}: WorkshopTaskAdminDialogsProps) {
  const { tabletModeEnabled } = useTabletMode();
  const categoryDialogRef = useRef<HTMLDivElement>(null);
  const isCategoryDirty = useMemo(() => {
    const initialName = editingCategory?.name ?? '';
    return categoryName.trim() !== initialName.trim();
  }, [categoryName, editingCategory]);

  return (
    <>
      {showSettings && (
        <Dialog
          open={showCategoryModal}
          onOpenChange={(open) => {
            if (!open && isCategoryDirty) {
              triggerShakeAnimation(categoryDialogRef.current);
              return;
            }
            onShowCategoryModalChange(open);
          }}
        >
          <DialogContent
            ref={categoryDialogRef}
            className={`bg-white dark:bg-slate-900 border-border text-foreground max-w-lg ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
            onInteractOutside={(event) => {
              if (isCategoryDirty) {
                event.preventDefault();
                triggerShakeAnimation(categoryDialogRef.current);
              }
            }}
            onEscapeKeyDown={(event) => {
              if (isCategoryDirty) {
                event.preventDefault();
                triggerShakeAnimation(categoryDialogRef.current);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-foreground text-xl">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {editingCategory ? 'Update the category details' : 'Create a new workshop task category'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category-name" className="text-foreground">
                  Category Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="category-name"
                  value={categoryName}
                  onChange={(e) => onCategoryNameChange(e.target.value)}
                  placeholder="e.g., Brakes, Engine, Electrical"
                  className={`bg-white dark:bg-slate-800 border-border text-foreground ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground">
                  Categories are automatically organized alphabetically
                </p>
              </div>
            </div>

            <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
              <Button
                variant="outline"
                onClick={onResetCategoryForm}
                className={`border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
              >
                {isCategoryDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                onClick={onSaveCategory}
                disabled={submittingCategory || !categoryName.trim()}
                className={`bg-workshop hover:bg-workshop-dark text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
              >
                {submittingCategory ? 'Saving...' : (editingCategory ? 'Update' : 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={onShowDeleteConfirmChange}>
        <DialogContent className={`max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto bg-white dark:bg-slate-900 border-border text-foreground max-w-md ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}>
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Delete Workshop Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {taskToDelete && (
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg space-y-2">
              <p className="font-semibold text-foreground">
                {getVehicleReg(taskToDelete)}
              </p>
              {taskToDelete.workshop_comments && (
                <p className="text-sm text-muted-foreground">
                  {taskToDelete.workshop_comments}
                </p>
              )}
            </div>
          )}

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button
              variant="outline"
              onClick={onResetDeleteTask}
              disabled={deleting}
              className={`border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirmDeleteTask}
              disabled={deleting}
              className={`bg-red-600 hover:bg-red-700 text-white ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
            >
              {deleting ? 'Deleting...' : 'Delete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
