'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FileText,
  Users,
  CheckCircle2,
  Clock,
  Eye,
  Download,
  FileDown,
  UserPlus,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import { formatDate } from '@/lib/utils/date';
import { AssignEmployeesModal } from '@/components/rams/AssignEmployeesModal';
import { formatFileSize } from '@/lib/utils/file-validation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

interface RAMSDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  created_at: string;
  uploader_name?: string;
}

interface Assignment {
  id: string;
  employee_id: string;
  status: string;
  assigned_at: string;
  read_at: string | null;
  signed_at: string | null;
  employee: {
    id: string;
    full_name: string;
    role: string;
  };
}

interface VisitorSignature {
  id: string;
  visitor_name: string;
  visitor_company: string | null;
  visitor_role: string | null;
  signed_at: string;
  recorded_by: string;
  recorder: {
    full_name: string;
  };
}

export default function RAMSDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canAccessProjectsModule, loading: projectsPermissionLoading } = usePermissionCheck('rams', false);
  const documentId = params.id as string;

  const [ramsDocument, setRamsDocument] = useState<RAMSDocument | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [visitorSignatures, setVisitorSignatures] = useState<VisitorSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [requiredSignature, setRequiredSignature] = useState(true);
  const [isFavourite, setIsFavourite] = useState(false);
  const [favouriteLoading, setFavouriteLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'employees' | 'visitors'>('employees');

  const supabase = createClient();

  // Redirect non-managers/admins
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

  useEffect(() => {
    const requestedTab = searchParams.get('tab') || 'employees';
    if (requestedTab === 'employees' || requestedTab === 'visitors') {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('employees');
    router.replace(`/projects/${documentId}?tab=employees`, { scroll: false });
  }, [searchParams, router, documentId]);

  function handleTabChange(value: 'employees' | 'visitors') {
    setActiveTab(value);
    router.replace(`/projects/${documentId}?tab=${value}`, { scroll: false });
  }

  const fetchDocumentDetails = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch document - use maybeSingle() instead of single() to handle 0 rows gracefully
      const { data: doc, error: docError } = await supabase
        .from('rams_documents')
        .select(`
          *,
          uploader:profiles!rams_documents_uploaded_by_fkey(full_name),
          document_type:project_document_types(id, name, required_signature)
        `)
        .eq('id', documentId)
        .maybeSingle();

      if (docError) {
        const errorContextId = 'projects-details-fetch-document-error';
        console.error('Error fetching document:', {
          error: docError,
          message: docError.message,
          code: docError.code,
          details: docError.details,
          hint: docError.hint,
          documentId,
          errorContextId,
        });
        setLoading(false);
        return;
      }

      if (!doc) {
        console.error('Document not found or no permission. ID:', documentId);
        setLoading(false);
        return;
      }

      setRamsDocument({
        ...doc,
        created_at: doc.created_at ?? '',
        uploader_name: doc.uploader?.full_name || 'Unknown',
      });
      setRequiredSignature((doc as { document_type?: { required_signature?: boolean } | null }).document_type?.required_signature ?? true);

      // Fetch assignments
      const { data: assignData, error: assignError } = await supabase
        .from('rams_assignments')
        .select(`
          *,
          employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
        `)
        .eq('rams_document_id', documentId)
        .order('assigned_at', { ascending: false });

      if (!assignError && assignData) {
        setAssignments(assignData.map((assignment) => ({
          ...assignment,
          employee_id: assignment.employee_id ?? '',
          status: assignment.status ?? 'pending',
          assigned_at: assignment.assigned_at ?? '',
          employee: {
            id: assignment.employee?.id ?? assignment.employee_id ?? '',
            full_name: assignment.employee?.full_name ?? 'Unknown',
            role: assignment.employee?.role ?? '',
          },
        })));
      }

      // Fetch visitor signatures
      const { data: visitorData, error: visitorError } = await supabase
        .from('rams_visitor_signatures')
        .select(`
          *,
          recorder:profiles!rams_visitor_signatures_recorded_by_fkey(full_name)
        `)
        .eq('rams_document_id', documentId)
        .order('signed_at', { ascending: false });

      if (!visitorError && visitorData) {
        setVisitorSignatures(visitorData.map((signature) => ({
          ...signature,
          signed_at: signature.signed_at ?? '',
          recorded_by: signature.recorded_by ?? '',
          recorder: signature.recorder ?? {
            full_name: 'Unknown',
          },
        })));
      }

      // Check if document is favourited
      const { data: favData } = await supabase
        .from('project_favourites')
        .select('id')
        .eq('document_id', documentId)
        .maybeSingle();

      setIsFavourite(!!favData);
    } catch (error) {
      const errorContextId = 'projects-details-fetch-page-data-error';
      console.error('Error fetching document details:', error, { errorContextId });
      toast.error('Failed to load document details', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [documentId, supabase]);

  useEffect(() => {
    if (!authLoading && !projectsPermissionLoading && canAccessProjectsModule && (isManager || isAdmin) && documentId) {
      fetchDocumentDetails();
    }
  }, [documentId, authLoading, projectsPermissionLoading, canAccessProjectsModule, isManager, isAdmin, fetchDocumentDetails]);

  const handleAssignSuccess = () => {
    setAssignModalOpen(false);
    fetchDocumentDetails();
  };

  const toggleFavourite = async () => {
    setFavouriteLoading(true);
    try {
      if (isFavourite) {
        const res = await fetch(`/api/projects/favourites?document_id=${documentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        setIsFavourite(false);
        toast.success('Removed from favourites');
      } else {
        const res = await fetch('/api/projects/favourites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: documentId }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        setIsFavourite(true);
        toast.success('Added to favourites');
      }
    } catch (error) {
      const errorContextId = 'projects-details-toggle-favourite-error';
      console.error('Error updating favourites:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to update favourites', { id: errorContextId });
    } finally {
      setFavouriteLoading(false);
    }
  };

  const downloadDocument = async () => {
    if (!ramsDocument) return;

    try {
      const { data } = await supabase.storage
        .from('rams-documents')
        .createSignedUrl(ramsDocument.file_path, 3600);

      if (data?.signedUrl) {
        // Use proper download method that works on mobile
        // Fetch the file and create a blob URL for download
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ramsDocument.file_name || 'rams-document.pdf';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      const errorContextId = 'projects-details-download-document-error';
      console.error('Error downloading document:', error, { errorContextId });
      // Fallback to opening/viewing if download fails
      try {
        const { data } = await supabase.storage
          .from('rams-documents')
          .createSignedUrl(ramsDocument.file_path, 3600);
        if (data?.signedUrl) {
          const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          
          if (isStandalone || isMobile) {
            // Use in-app PDF viewer for PWA/mobile
            router.push(`/pdf-viewer?url=${encodeURIComponent(data.signedUrl)}&title=${encodeURIComponent(ramsDocument.title)}&return=${encodeURIComponent(`/projects/${documentId}`)}`);
          } else {
            // Desktop: Open in new tab
            window.open(data.signedUrl, '_blank');
          }
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError, { errorContextId });
        toast.error('Failed to download or open document', { id: errorContextId });
      }
    }
  };

  const exportPDF = async () => {
    if (!ramsDocument) return;

    try {
      const response = await fetch(`/api/rams/${documentId}/export`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ramsDocument.title.replace(/[^a-z0-9]/gi, '_')}_signatures.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const errorContextId = 'projects-details-export-pdf-error';
      console.error('Error exporting PDF:', error, { errorContextId });
      toast.error('Failed to export signatures PDF', { id: errorContextId });
    }
  };

  // Show loading while checking auth or redirecting
  if (authLoading || projectsPermissionLoading || (!isManager && !isAdmin)) {
    return <PageLoader message="Loading project details..." />;
  }

  if (!canAccessProjectsModule) {
    return null;
  }

  if (loading) {
    return <PageLoader message="Loading project details..." />;
  }

  if (!ramsDocument) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Document not found</h3>
          <p className="text-muted-foreground mb-4">
            This document may have been deleted or you don&apos;t have permission to view it.
          </p>
          <BackButton userRole={{ isManager, isAdmin }} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalAssigned = assignments.length;
  const totalComplete = requiredSignature
    ? assignments.filter(a => a.status === 'signed').length
    : assignments.filter(a => a.status === 'read' || a.status === 'signed').length;
  const totalPending = totalAssigned - totalComplete;
  const complianceRate = totalAssigned > 0 ? Math.round((totalComplete / totalAssigned) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <BackButton userRole={{ isManager, isAdmin }} />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{ramsDocument.title}</h1>
              <p className="text-muted-foreground">
                Uploaded {formatDate(ramsDocument.created_at)} by{' '}
                {ramsDocument.uploader_name}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={toggleFavourite}
              disabled={favouriteLoading}
              className={`border-border transition-all duration-200 ${
                isFavourite
                  ? 'text-yellow-500 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950'
                  : 'text-muted-foreground hover:bg-slate-700/50'
              }`}
              title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            >
              <Star className={`h-4 w-4 mr-2 ${isFavourite ? 'fill-current' : ''}`} />
              {isFavourite ? 'Favourited' : 'Favourite'}
            </Button>
            <Button 
              variant="outline" 
              onClick={exportPDF}
              className="border-border text-muted-foreground hover:bg-slate-700/50"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button 
              variant="outline" 
              onClick={downloadDocument}
              className="border-border text-muted-foreground hover:bg-slate-700/50"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button 
              onClick={() => setAssignModalOpen(true)}
              className="bg-rams hover:bg-rams-dark text-white transition-all duration-200 active:scale-95"
            >
              <Users className="h-4 w-4 mr-2" />
              Assign Employees
            </Button>
          </div>
        </div>
      </div>

      {/* Compact Summary */}
      <div className="bg-white dark:bg-slate-900 rounded-lg px-4 py-3 border border-border flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Assigned:</span>
          <span className="font-semibold text-foreground">{totalAssigned}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-muted-foreground">{requiredSignature ? 'Signed' : 'Read'}:</span>
          <span className="font-semibold text-green-600">{totalComplete}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-orange-500" />
          <span className="text-muted-foreground">Pending:</span>
          <span className="font-semibold text-orange-600">{totalPending}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Compliance:</span>
          <span className={`font-semibold ${
            complianceRate === 100 ? 'text-green-600' : complianceRate === 0 && totalAssigned > 0 ? 'text-red-600' : 'text-foreground'
          }`}>{complianceRate}%</span>
        </div>
      </div>

      {/* Document Info */}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-foreground">Document Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ramsDocument.description && (
            <div>
              <span className="font-semibold text-foreground">Description: </span>
              <span className="text-muted-foreground">{ramsDocument.description}</span>
            </div>
          )}
          <div>
            <span className="font-semibold text-foreground">File: </span>
            <span className="text-muted-foreground">
              {ramsDocument.file_name} ({ramsDocument.file_type.toUpperCase()} •{' '}
              {formatFileSize(ramsDocument.file_size)})
            </span>
          </div>
          <div>
            <span className="font-semibold text-foreground">Created: </span>
            <span className="text-muted-foreground">
              {new Date(ramsDocument.created_at).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as 'employees' | 'visitors')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees">
            <Users className="h-4 w-4 mr-2" />
            Employees ({totalAssigned})
          </TabsTrigger>
          <TabsTrigger value="visitors">
            <UserPlus className="h-4 w-4 mr-2" />
            Visitors ({visitorSignatures.length})
          </TabsTrigger>
        </TabsList>

        {/* Employees Tab */}
        <TabsContent value="employees" className="space-y-4">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">Employee Assignments</CardTitle>
              <CardDescription className="text-muted-foreground">
                Track which employees have been assigned and signed this document
              </CardDescription>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No employees assigned yet</p>
                  <Button
                    onClick={() => setAssignModalOpen(true)}
                    className="mt-4"
                    variant="outline"
                  >
                    Assign Employees
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>{requiredSignature ? 'Signed' : 'Read'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map(assignment => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">
                          {assignment.employee.full_name}
                        </TableCell>
                        <TableCell className="capitalize">
                          {assignment.employee.role}
                        </TableCell>
                        <TableCell>
                          {assignment.status === 'signed' ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Signed
                            </Badge>
                          ) : assignment.status === 'read' ? (
                            <Badge variant={!requiredSignature ? 'default' : 'secondary'} className="gap-1">
                              <Eye className="h-3 w-3" />
                              {!requiredSignature ? 'Read (Complete)' : 'Read'}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <Clock className="h-3 w-3" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {formatDate(assignment.assigned_at)}
                        </TableCell>
                        <TableCell>
                          {requiredSignature
                            ? (assignment.signed_at
                                ? formatDate(assignment.signed_at)
                                : '-')
                            : (assignment.read_at
                                ? formatDate(assignment.read_at)
                                : '-')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visitors Tab */}
        <TabsContent value="visitors" className="space-y-4">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">Visitor Signatures</CardTitle>
              <CardDescription className="text-muted-foreground">
                Signatures captured from visitors and contractors
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visitorSignatures.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No visitor signatures recorded yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Visitor Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Signed</TableHead>
                      <TableHead>Recorded By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitorSignatures.map(signature => (
                      <TableRow key={signature.id}>
                        <TableCell className="font-medium">
                          {signature.visitor_name}
                        </TableCell>
                        <TableCell>{signature.visitor_company || '-'}</TableCell>
                        <TableCell>{signature.visitor_role || '-'}</TableCell>
                        <TableCell>
                          {formatDate(signature.signed_at)}
                        </TableCell>
                        <TableCell>{signature.recorder.full_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign Modal */}
      <AssignEmployeesModal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        onSuccess={handleAssignSuccess}
        documentId={documentId}
        documentTitle={ramsDocument.title}
      />
    </div>
  );
}

