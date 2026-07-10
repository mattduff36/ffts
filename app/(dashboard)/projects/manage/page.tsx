'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  useManageDocuments,
  useFavourites,
  useDocumentTypes,
  useDeleteDocument,
  useAddFavourite,
  useRemoveFavourite,
  projectsManageKeys,
  type FavouriteRow,
} from '@/lib/hooks/useProjectsManage';
import { UploadRAMSModal, type UploadSubmitPayload } from '@/components/rams/UploadRAMSModal';
import { ProjectsManageToolbar } from '@/components/projects/manage/ProjectsManageToolbar';
import { ProjectsManageFilters } from '@/components/projects/manage/ProjectsManageFilters';
import { ProjectsFavouriteStrip } from '@/components/projects/manage/ProjectsFavouriteStrip';
import { ProjectsDocumentsTable } from '@/components/projects/manage/ProjectsDocumentsTable';
import { ProjectsDocumentsMobileCards } from '@/components/projects/manage/ProjectsDocumentsMobileCards';
import { AppPageShell } from '@/components/layout/AppPageShell';
import type { ManageDocumentRow, ManageDocumentsQuery } from '@/types/rams';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { FileText, Upload } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Monitor } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

export interface UploadingDoc {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  documentTypeName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'error';
}

export default function ProjectsManagePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canAccessProjectsModule, loading: projectsPermissionLoading } = usePermissionCheck('rams', false);

  // Search / filter / sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState<NonNullable<ManageDocumentsQuery['sortBy']>>('created_at');
  const [sortDir, setSortDir] = useState<NonNullable<ManageDocumentsQuery['sortDir']>>('desc');

  // Pagination: show N documents, "Show more" loads 30 more
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Upload modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [reuseDoc, setReuseDoc] = useState<{ title: string; description: string; typeId: string } | null>(null);

  // In-flight uploads shown in the table
  const [uploadingDocs, setUploadingDocs] = useState<UploadingDoc[]>([]);
  const xhrMapRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<ManageDocumentRow | null>(null);

  // PDF viewer dialog
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfViewerTitle, setPdfViewerTitle] = useState('');
  const [pdfViewerLoading, setPdfViewerLoading] = useState(false);
  const supabase = createClient();

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset visible count when filters or sort change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, typeFilter, sortBy, sortDir]);

  const queryParams: ManageDocumentsQuery = useMemo(() => ({
    q: debouncedSearch || undefined,
    type: typeFilter || undefined,
    sortBy,
    sortDir,
    limit: 200,
  }), [debouncedSearch, typeFilter, sortBy, sortDir]);

  // Data hooks
  const {
    data: docsData,
    isLoading: docsLoading,
    error: docsError,
  } = useManageDocuments(queryParams);

  const { data: favsData } = useFavourites();
  const { data: typesData } = useDocumentTypes();

  // Mutations
  const deleteDoc = useDeleteDocument();
  const addFav = useAddFavourite();
  const removeFav = useRemoveFavourite();

  // Redirect non-managers
  useEffect(() => {
    if (authLoading || projectsPermissionLoading) return;

    if (!canAccessProjectsModule) {
      router.push('/dashboard');
      return;
    }

    if (!isManager && !isAdmin) {
      router.push('/projects');
    }
  }, [isManager, isAdmin, authLoading, projectsPermissionLoading, canAccessProjectsModule, router]);

  // Derived data
  const allDocuments = useMemo(() => docsData?.documents ?? [], [docsData?.documents]);
  const total = docsData?.total ?? 0;
  const documents = useMemo(() => allDocuments.slice(0, visibleCount), [allDocuments, visibleCount]);
  const hasMoreDocuments = allDocuments.length > visibleCount;
  const favourites = favsData?.favourites ?? [];
  const documentTypes = useMemo(
    () => (typesData?.types ?? []).filter(t => t.is_active).map(t => ({ id: t.id, name: t.name })),
    [typesData],
  );

  const hasActiveFilters = !!(debouncedSearch || typeFilter);

  // Handlers
  const handleSortChange = useCallback((field: NonNullable<ManageDocumentsQuery['sortBy']>, dir?: NonNullable<ManageDocumentsQuery['sortDir']>) => {
    if (dir) {
      setSortBy(field);
      setSortDir(dir);
    } else {
      setSortBy((prev) => {
        if (prev === field) {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          return prev;
        }
        setSortDir(field === 'title' ? 'asc' : 'desc');
        return field;
      });
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setTypeFilter('');
  }, []);

  const handleReuse = useCallback((fav: FavouriteRow) => {
    setReuseDoc({
      title: fav.document.title,
      description: fav.document.description || '',
      typeId: fav.document.document_type_id || fav.document.document_type?.id || '',
    });
    setUploadModalOpen(true);
  }, []);

  const handleReuseFromRow = useCallback((doc: ManageDocumentRow) => {
    setReuseDoc({
      title: doc.title,
      description: doc.description || '',
      typeId: doc.document_type_id || '',
    });
    setUploadModalOpen(true);
  }, []);

  const handleToggleFavourite = useCallback((doc: ManageDocumentRow) => {
    if (doc.is_favourite) {
      removeFav.mutate(doc.id);
    } else {
      addFav.mutate(doc.id);
    }
  }, [addFav, removeFav]);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    deleteDoc.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }, [deleteTarget, deleteDoc]);

  const handleUploadSubmit = useCallback((payload: UploadSubmitPayload) => {
    const uploadId = `upload-${Date.now()}`;

    setUploadingDocs(prev => [{
      id: uploadId,
      title: payload.title,
      fileName: payload.file.name,
      fileSize: payload.file.size,
      fileType: payload.file.name.split('.').pop()?.toLowerCase() || 'pdf',
      documentTypeName: payload.documentTypeName,
      progress: 0,
      status: 'uploading',
    }, ...prev]);

    const formData = new FormData();
    formData.append('file', payload.file);
    formData.append('title', payload.title);
    if (payload.description) formData.append('description', payload.description);
    if (payload.documentTypeId) formData.append('document_type_id', payload.documentTypeId);
    if (payload.quoteId) formData.append('quote_id', payload.quoteId);

    const xhr = new XMLHttpRequest();
    xhrMapRef.current.set(uploadId, xhr);

    xhr.upload.addEventListener('progress', (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setUploadingDocs(prev =>
          prev.map(d => d.id === uploadId
            ? { ...d, progress: pct, status: pct === 100 ? 'processing' : 'uploading' }
            : d
          )
        );
      }
    });

    xhr.addEventListener('load', async () => {
      xhrMapRef.current.delete(uploadId);
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success('Document uploaded successfully');
        setUploadingDocs(prev =>
          prev.map(d => d.id === uploadId ? { ...d, status: 'processing', progress: 100 } : d)
        );
        await queryClient.invalidateQueries({ queryKey: projectsManageKeys.all });
        setUploadingDocs(prev => prev.filter(d => d.id !== uploadId));
      } else {
        let errorMsg = 'Failed to upload document';
        try { const data = JSON.parse(xhr.responseText); if (data.error) errorMsg = data.error; } catch { /* use default */ }
        toast.error(errorMsg, { id: 'projects-manage-upload-document-error' });
        setUploadingDocs(prev =>
          prev.map(d => d.id === uploadId ? { ...d, status: 'error', progress: 0 } : d)
        );
      }
    });

    xhr.addEventListener('error', () => {
      xhrMapRef.current.delete(uploadId);
      toast.error('Upload failed. Please check your connection.', {
        id: 'projects-manage-upload-network-error',
      });
      setUploadingDocs(prev =>
        prev.map(d => d.id === uploadId ? { ...d, status: 'error', progress: 0 } : d)
      );
    });

    xhr.open('POST', '/api/rams/upload');
    xhr.send(formData);
  }, [queryClient]);

  const handleViewFavourite = useCallback(async (fav: FavouriteRow) => {
    if (!fav.document.file_path) {
      toast.error('File path not available', { id: 'projects-manage-view-favourite-filepath-missing' });
      return;
    }
    setPdfViewerTitle(fav.document.title);
    setPdfViewerLoading(true);
    setPdfViewerOpen(true);
    setPdfViewerUrl(null);

    try {
      const { data } = await supabase.storage
        .from('rams-documents')
        .createSignedUrl(fav.document.file_path, 3600);

      if (data?.signedUrl) {
        setPdfViewerUrl(data.signedUrl);
      } else {
        toast.error('Could not generate document URL', { id: 'projects-manage-view-favourite-url-generation-error' });
        setPdfViewerOpen(false);
      }
    } catch {
      toast.error('Failed to load document', { id: 'projects-manage-view-favourite-load-error' });
      setPdfViewerOpen(false);
    } finally {
      setPdfViewerLoading(false);
    }
  }, [supabase]);

  // Auth guard loading
  if (authLoading || projectsPermissionLoading || (!isManager && !isAdmin)) {
    return <PageLoader message="Loading project management..." />;
  }

  if (!canAccessProjectsModule) {
    return null;
  }

  return (
    <AppPageShell>
      {/* Mobile info banner */}
      <Alert className="md:hidden bg-blue-900/20 border-blue-700/50">
        <Monitor className="h-4 w-4 text-blue-400" />
        <AlertDescription className="text-blue-200 text-sm">
          Tap a document card to expand details and actions.
        </AlertDescription>
      </Alert>

      {/* Toolbar */}
      <ProjectsManageToolbar onUploadClick={() => setUploadModalOpen(true)} />

      {/* Favourites strip */}
      <ProjectsFavouriteStrip
        favourites={favourites}
        onReuse={handleReuse}
        onRemove={(id) => removeFav.mutate(id)}
        onView={handleViewFavourite}
      />

      {/* Filters */}
      <ProjectsManageFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        documentTypes={documentTypes}
        totalResults={total}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Document list */}
      {docsLoading ? (
        <div className="space-y-3">
          {/* Desktop skeleton */}
          <div className="hidden md:block rounded-lg border border-border overflow-hidden bg-white dark:bg-slate-900 p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      ) : docsError ? (
        <Card className="bg-white dark:bg-slate-900 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-destructive/50 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load documents</h3>
            <p className="text-muted-foreground mb-4 text-center text-sm">
              {(docsError as Error).message || 'Something went wrong. Please try again.'}
            </p>
          </CardContent>
        </Card>
      ) : documents.length === 0 && uploadingDocs.length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {hasActiveFilters ? 'No matching documents' : 'No documents yet'}
            </h3>
            <p className="text-muted-foreground mb-4 text-center text-sm">
              {hasActiveFilters
                ? 'Try adjusting your search or filters'
                : 'Upload your first project document to get started'}
            </p>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={handleClearFilters}>
                Clear Filters
              </Button>
            ) : (
              <Button
                onClick={() => setUploadModalOpen(true)}
                className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <ProjectsDocumentsTable
            documents={documents}
            uploadingDocs={uploadingDocs}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            onDelete={setDeleteTarget}
            onToggleFavourite={handleToggleFavourite}
            onReuse={handleReuseFromRow}
            onDismissUpload={(id) => setUploadingDocs(prev => prev.filter(d => d.id !== id))}
          />

          {/* Mobile cards */}
          <ProjectsDocumentsMobileCards
            documents={documents}
            uploadingDocs={uploadingDocs}
            onDelete={setDeleteTarget}
            onToggleFavourite={handleToggleFavourite}
            onReuse={handleReuseFromRow}
            onDismissUpload={(id) => setUploadingDocs(prev => prev.filter(d => d.id !== id))}
          />

          {/* Show more */}
          {hasMoreDocuments && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                className="px-8"
              >
                Show More
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing {documents.length} of {allDocuments.length} documents
              </span>
            </div>
          )}
        </>
      )}

      {/* Upload Modal */}
      <UploadRAMSModal
        open={uploadModalOpen}
        onClose={() => { setUploadModalOpen(false); setReuseDoc(null); }}
        onSubmit={handleUploadSubmit}
        prefillTitle={reuseDoc?.title}
        prefillDescription={reuseDoc?.description}
        prefillTypeId={reuseDoc?.typeId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Document</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{deleteTarget?.title}</span>?
              <br /><br />
              This action cannot be undone. The document and all associated signatures will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDoc.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteDoc.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDoc.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PDF Viewer Dialog */}
      <Dialog open={pdfViewerOpen} onOpenChange={(open) => { if (!open) { setPdfViewerOpen(false); setPdfViewerUrl(null); } }}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pr-12 py-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-foreground truncate">
                {pdfViewerTitle}
              </DialogTitle>
              {pdfViewerUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pdfViewerUrl, '_blank')}
                  className="shrink-0 text-xs"
                >
                  Open in New Tab
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {pdfViewerLoading ? (
              <PanelLoader message="Loading document preview..." accent="rams" className="h-full" />
            ) : pdfViewerUrl ? (
              <iframe
                src={pdfViewerUrl}
                className="w-full h-full border-0"
                title={pdfViewerTitle}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Failed to load document
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}
