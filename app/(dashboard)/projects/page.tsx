'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, FileText, CheckCircle2, Clock, Settings, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { formatFileSize } from '@/lib/utils/file-validation';
import { RecordVisitorSignatureModal } from '@/components/rams/RecordVisitorSignatureModal';
import { RAMSErrorBoundary } from '@/components/rams/RAMSErrorBoundary';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { isNetworkFetchError } from '@/lib/utils/http-error';

interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_size: number;
  file_type: string;
  created_at: string;
  uploader_name?: string;
  total_assigned?: number;
  total_signed?: number;
  total_pending?: number;
  assignment_status?: 'pending' | 'read' | 'signed';
  assigned_at?: string;
  signed_at?: string;
  document_type_name?: string | null;
  required_signature?: boolean;
}

function isDocumentComplete(doc: RAMSDocument): boolean {
  if (doc.required_signature === false) {
    return doc.assignment_status === 'read' || doc.assignment_status === 'signed';
  }
  return doc.assignment_status === 'signed';
}

export default function RAMSPage() {
  const { user, isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewProjects, loading: projectsPermissionLoading } = usePermissionCheck('rams');
  const [documents, setDocuments] = useState<RAMSDocument[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<RAMSDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'signed'>('all');
  const [visitorSignModalOpen, setVisitorSignModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocumentTitle, setSelectedDocumentTitle] = useState<string>('');

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch documents for all users (API handles permissions)
      const response = await fetch('/api/rams');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch RAMS documents: HTTP ${response.status}`);
      }
      
      const data = await response.json();

      if (data.success) {
        setDocuments(data.documents);
        setFilteredDocuments(data.documents);
      } else {
        throw new Error(data.error || 'Failed to fetch RAMS documents');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (
        !errorMessage.includes('HTTP 401') &&
        !errorMessage.includes('HTTP 403') &&
        !isNetworkFetchError(error)
      ) {
        console.error('Error fetching RAMS documents:', {
          message: errorMessage,
          timestamp: new Date().toISOString(),
          endpoint: '/api/rams'
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !projectsPermissionLoading && canViewProjects && user) {
      fetchDocuments();
    } else if (!authLoading && !projectsPermissionLoading) {
      setLoading(false);
    }
  }, [authLoading, projectsPermissionLoading, canViewProjects, fetchDocuments, user]);

  useEffect(() => {
    let filtered = documents;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(doc => {
        if (statusFilter === 'pending') {
          return !isDocumentComplete(doc);
        }
        return isDocumentComplete(doc);
      });
    }

    setFilteredDocuments(filtered);
  }, [searchQuery, documents, statusFilter]);

  const pendingCount = documents.filter(doc => !isDocumentComplete(doc)).length;

  // Show loading while checking auth
  if (authLoading || projectsPermissionLoading || loading) {
    return <PageLoader message="Loading projects..." />;
  }

  if (!canViewProjects) {
    return null;
  }

  return (
    <RAMSErrorBoundary>
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-2">Projects</h1>
            <p className="text-muted-foreground">
              {isManager || isAdmin 
                ? 'View and manage project documents'
                : 'Review and acknowledge project documents'
              }
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {/* Manage Projects link for managers/admins */}
            {(isManager || isAdmin) && (
              <Link href="/projects/manage" className="w-full sm:w-auto">
                <Button className="w-full bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg sm:w-auto">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Projects
                </Button>
              </Link>
            )}

            {/* Pending count badge for employees */}
            {!isManager && !isAdmin && pendingCount > 0 && (
              <Badge variant="destructive" className="w-fit text-lg px-4 py-2">
                {pendingCount} pending
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 bg-white dark:bg-slate-900 border-border text-foreground"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStatusFilter('all')}
                className={statusFilter === 'all' ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
              >
                All
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatusFilter('pending')}
                className={statusFilter === 'pending' ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
              >
                Pending
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatusFilter('signed')}
                className={statusFilter === 'signed' ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
              >
                Complete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {filteredDocuments.length === 0 ? (
        <Card className="">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No documents found</h3>
            <p className="text-muted-foreground mb-4 text-center">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'No documents have been assigned to you yet'
              }
            </p>
            {(isManager || isAdmin) && !searchQuery && statusFilter === 'all' && (
              <Link href="/projects/manage">
                <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Projects
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id} className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-rams/50 transition-all duration-200 cursor-pointer">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <CardTitle className="text-xl">{doc.title}</CardTitle>
                      {doc.document_type_name && (
                        <Badge variant="outline" className="text-xs">
                          {doc.document_type_name}
                        </Badge>
                      )}
                      <Badge
                        variant={isDocumentComplete(doc) ? 'default' : 'destructive'}
                      >
                        {isDocumentComplete(doc) ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {doc.required_signature === false ? 'Read' : 'Signed'}
                          </>
                        ) : (
                          <>
                            <Clock className="h-3 w-3 mr-1" />
                            {doc.required_signature === false ? 'Unread' : 'Needs Signature'}
                          </>
                        )}
                      </Badge>
                    </div>
                    {doc.description && (
                      <CardDescription className="mt-2">{doc.description}</CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span>
                      {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)}
                    </span>
                    <span>
                      Uploaded {formatDate(doc.created_at)}
                    </span>
                    {doc.assigned_at && (
                      <span>
                        Assigned {formatDate(doc.assigned_at)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Link href={`/projects/${doc.id}/read?from=/projects`}>
                      <Button className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95">
                        {isDocumentComplete(doc)
                          ? 'View Document'
                          : doc.required_signature === false
                            ? 'Read Document'
                            : 'Read & Sign'}
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedDocumentId(doc.id);
                        setSelectedDocumentTitle(doc.title);
                        setVisitorSignModalOpen(true);
                      }}
                      disabled={doc.assignment_status !== 'signed'}
                      className="border-rams text-rams hover:bg-rams hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-rams"
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Record Visitor
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Visitor Signature Modal */}
      {selectedDocumentId && (
        <RecordVisitorSignatureModal
          open={visitorSignModalOpen}
          onClose={() => {
            setVisitorSignModalOpen(false);
            setSelectedDocumentId(null);
            setSelectedDocumentTitle('');
          }}
          onSuccess={() => {
            setVisitorSignModalOpen(false);
            setSelectedDocumentId(null);
            setSelectedDocumentTitle('');
            fetchDocuments(); // Refresh the documents list
          }}
          documentId={selectedDocumentId}
          documentTitle={selectedDocumentTitle}
        />
      )}
    </AppPageShell>
    </RAMSErrorBoundary>
  );
}

