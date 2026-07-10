type Listener = () => void;

const dirtyDraftIds = new Set<string>();
const activeWorkflowIds = new Set<string>();
const listeners = new Set<Listener>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function setWorkshopDraftDirty(draftId: string, isDirty: boolean) {
  const hadDraft = dirtyDraftIds.has(draftId);
  if (isDirty) dirtyDraftIds.add(draftId);
  else dirtyDraftIds.delete(draftId);

  if (hadDraft !== isDirty) emitChange();
}

export function setWorkshopWorkflowActive(workflowId: string, isActive: boolean) {
  const hadWorkflow = activeWorkflowIds.has(workflowId);
  if (isActive) activeWorkflowIds.add(workflowId);
  else activeWorkflowIds.delete(workflowId);

  if (hadWorkflow !== isActive) emitChange();
}

export function hasWorkshopDirtyDrafts(): boolean {
  return dirtyDraftIds.size > 0;
}

export function hasWorkshopActiveWorkflows(): boolean {
  return activeWorkflowIds.size > 0;
}

export function subscribeToWorkshopDraftActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
