'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReviewDetailDialog } from '@/components/management/ReviewDetailDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SuggestionCreateDialog } from '@/components/suggestions/suggestion-create-dialog';
import { 
  Lightbulb, 
  Loader2, 
  Search,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils/date';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import type { SuggestionWithUser, SuggestionStatus, SuggestionUpdateWithUser } from '@/types/faq';
import { SUGGESTION_STATUS_LABELS, SUGGESTION_STATUS_COLORS } from '@/types/faq';

export default function SuggestionsManagePage() {
  const router = useRouter();
  const { hasPermission: canManageSuggestions, loading: permissionLoading } = usePermissionCheck('suggestions', false);
  
  const [suggestions, setSuggestions] = useState<SuggestionWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
  // Detail dialog
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionWithUser | null>(null);
  const [suggestionUpdates, setSuggestionUpdates] = useState<SuggestionUpdateWithUser[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Update form
  const [newStatus, setNewStatus] = useState<SuggestionStatus | ''>('');
  const [adminNote, setAdminNote] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [updating, setUpdating] = useState(false);

  // Redirect non-managers
  useEffect(() => {
    if (!permissionLoading && !canManageSuggestions) {
      router.push('/dashboard');
    }
  }, [permissionLoading, canManageSuggestions, router]);

  const fetchSuggestions = useCallback(async (filter: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.set('status', filter);
      }
      const endpoint = params.size > 0
        ? `/api/management/suggestions?${params.toString()}`
        : '/api/management/suggestions';
      const result = await fetchAllPaginatedItems<SuggestionWithUser>(endpoint, 'suggestions', {
        limit: 200,
        errorMessage: 'Failed to fetch suggestions',
      });

      setSuggestions(result.items);
      setCounts((result.firstPagePayload?.counts as Record<string, number> | undefined) || {});
      setCountsLoaded(true);
    } catch (error) {
      const errorContextId = 'suggestions-manage-fetch-list-error';
      console.error('Error fetching suggestions:', error, { errorContextId });
      toast.error('Failed to load suggestions', { id: errorContextId });
      setCountsLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch suggestions
  useEffect(() => {
    if (canManageSuggestions) {
      fetchSuggestions(statusFilter);
    }
  }, [statusFilter, canManageSuggestions, fetchSuggestions]);

  const openDetailDialog = async (suggestion: SuggestionWithUser) => {
    setSelectedSuggestion(suggestion);
    setNewStatus(suggestion.status);
    setAdminNote(suggestion.admin_notes || '');
    setUpdateNote('');
    setDetailDialogOpen(true);
    
    // Fetch update history
    try {
      setLoadingDetail(true);
      const response = await fetch(`/api/management/suggestions/${suggestion.id}`);
      const data = await response.json();
      
      if (data.success) {
        setSuggestionUpdates(data.updates || []);
      }
    } catch (error) {
      const errorContextId = 'suggestions-manage-fetch-details-error';
      console.error('Error fetching suggestion details:', error, { errorContextId });
      toast.error('Failed to load suggestion details', { id: errorContextId });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdateSuggestion = async () => {
    if (!selectedSuggestion) return;
    
    try {
      setUpdating(true);
      
      const response = await fetch(`/api/management/suggestions/${selectedSuggestion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus || undefined,
          admin_notes: adminNote || undefined,
          note: updateNote || undefined,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('Suggestion updated');
        setDetailDialogOpen(false);
        fetchSuggestions(statusFilter);
      } else {
        throw new Error(data.error || 'Failed to update suggestion');
      }
    } catch (error) {
      const errorContextId = 'suggestions-manage-update-suggestion-error';
      console.error('Error updating suggestion:', error, { errorContextId });
      toast.error('Failed to update suggestion', { id: errorContextId });
    } finally {
      setUpdating(false);
    }
  };

  // Filter suggestions by search
  const filteredSuggestions = suggestions.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(query) ||
      s.body.toLowerCase().includes(query) ||
      s.user?.full_name?.toLowerCase().includes(query)
    );
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'new': return <Clock className="h-4 w-4" />;
      case 'under_review': return <AlertTriangle className="h-4 w-4" />;
      case 'planned': return <MessageSquare className="h-4 w-4" />;
      case 'completed': return <CheckCircle2 className="h-4 w-4" />;
      case 'declined': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (permissionLoading) {
    return <PageLoader message="Loading suggestions..." />;
  }

  if (!canManageSuggestions) {
    return null;
  }

  const showCountsLoading = loading && !countsLoaded;

  return (
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="shrink-0 p-3 bg-yellow-100 dark:bg-yellow-950 rounded-lg">
              <Lightbulb className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Manage Suggestions
              </h1>
              <p className="text-muted-foreground">
                Review and respond to user suggestions
              </p>
            </div>
          </div>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            className="w-full shrink-0 bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add suggestion
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { key: 'all', label: 'All', color: 'bg-slate-500' },
          { key: 'new', label: 'New', color: 'bg-blue-500' },
          { key: 'under_review', label: 'Reviewing', color: 'bg-yellow-500' },
          { key: 'planned', label: 'Planned', color: 'bg-purple-500' },
          { key: 'completed', label: 'Done', color: 'bg-green-500' },
          { key: 'declined', label: 'Declined', color: 'bg-slate-400' },
        ].map(({ key, label, color }) => (
          <Card 
            key={key}
            className={`cursor-pointer transition-all ${
              statusFilter === key ? 'ring-2 ring-yellow-500 bg-white/10' : ''
            } bg-white dark:bg-slate-900 border-border`}
            onClick={() => setStatusFilter(key)}
          >
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {showCountsLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">
                      {counts[key] || 0}
                    </p>
                  )}
                </div>
                <div className={`h-3 w-3 rounded-full ${color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card className="">
        <CardContent className="pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search suggestions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
            />
          </div>
        </CardContent>
      </Card>

      {/* Suggestions List */}
      <Card className="">
        <CardHeader>
          <CardTitle className="text-foreground">
            Suggestions
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PanelLoader message="Loading suggestions..." className="py-8" />
          ) : filteredSuggestions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p>No suggestions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => openDetailDialog(suggestion)}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 font-medium text-foreground">
                          {suggestion.title}
                        </h3>
                        <Badge className={`${SUGGESTION_STATUS_COLORS[suggestion.status]} text-white shrink-0`}>
                          {getStatusIcon(suggestion.status)}
                          <span className="ml-1">{SUGGESTION_STATUS_LABELS[suggestion.status]}</span>
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground line-clamp-2">
                        {suggestion.body}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {suggestion.user?.full_name || 'Unknown'}
                        </span>
                        <span>{formatDateTime(suggestion.created_at)}</span>
                        {suggestion.page_hint && (
                          <span className="text-muted-foreground">
                            Related to: {suggestion.page_hint}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <ReviewDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        title="Suggestion Details"
        description="Review the suggestion, related page, admin notes, and update history."
        icon={<Lightbulb className="h-5 w-5 text-brand-yellow" />}
        statusBadge={selectedSuggestion ? (
          <Badge className={`${SUGGESTION_STATUS_COLORS[selectedSuggestion.status]} text-white`}>
            {SUGGESTION_STATUS_LABELS[selectedSuggestion.status]}
          </Badge>
        ) : null}
        sidebar={selectedSuggestion ? (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-100">Admin update</h3>
                <p className="text-xs text-slate-400">
                  Track the decision, private notes, and the visible update trail.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="suggestion-status" className="text-slate-300">Status</Label>
                  <Select value={newStatus} onValueChange={(v) => setNewStatus(v as SuggestionStatus)}>
                    <SelectTrigger id="suggestion-status" className="border-slate-700 bg-slate-950 text-slate-100">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="under_review">Under Review</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="suggestion-admin-note" className="text-slate-300">
                    Internal Notes (not visible to submitter)
                  </Label>
                  <Textarea
                    id="suggestion-admin-note"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add internal notes..."
                    rows={5}
                    className="border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="suggestion-update-note" className="text-slate-300">
                    Update Note (for history)
                  </Label>
                  <Input
                    id="suggestion-update-note"
                    value={updateNote}
                    onChange={(e) => setUpdateNote(e.target.value)}
                    placeholder="Brief note about this update..."
                    className="border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-100">History</h3>
              </div>
              {loadingDetail ? (
                <PanelLoader message="Loading update history..." className="py-4" />
              ) : suggestionUpdates.length > 0 ? (
                <ScrollArea className="max-h-[32vh] pr-2">
                  <div className="space-y-2">
                    {suggestionUpdates.map((update) => (
                      <div
                        key={update.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-200">
                            {update.old_status && update.new_status ? (
                              <>
                                {SUGGESTION_STATUS_LABELS[update.old_status]} → {SUGGESTION_STATUS_LABELS[update.new_status]}
                              </>
                            ) : (
                              'Note added'
                            )}
                          </span>
                          <span className="text-slate-500">
                            {new Date(update.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {update.note && (
                          <p className="mt-2 whitespace-pre-wrap leading-5 text-slate-300">
                            {update.note}
                          </p>
                        )}
                        <p className="mt-2 text-slate-500">
                          by {update.user?.full_name || 'Unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-slate-400">No history has been added yet.</p>
              )}
            </section>
          </>
        ) : null}
        footer={(
          <>
            <Button
              variant="outline"
              onClick={() => setDetailDialogOpen(false)}
              className="border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800 hover:text-slate-50"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateSuggestion}
              disabled={updating}
              className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow-hover"
            >
              {updating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </>
        )}
      >
        {selectedSuggestion && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
            <div className="mb-4 min-w-0">
              <h3 className="text-lg font-semibold leading-6 text-slate-50">
                {selectedSuggestion.title}
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Submitted by {selectedSuggestion.user?.full_name || 'Unknown'} on {formatDateTime(selectedSuggestion.created_at)}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {selectedSuggestion.body}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-400 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <span className="block text-slate-500">Submitter</span>
                <span className="mt-1 block text-slate-200">{selectedSuggestion.user?.full_name || 'Unknown'}</span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <span className="block text-slate-500">Submitted</span>
                <span className="mt-1 block text-slate-200">{formatDateTime(selectedSuggestion.created_at)}</span>
              </div>
              {selectedSuggestion.page_hint && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 sm:col-span-2">
                  <span className="block text-slate-500">Related page</span>
                  <span className="mt-1 block break-words text-slate-200">
                    {selectedSuggestion.page_hint}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}
      </ReviewDetailDialog>

      <SuggestionCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={async () => {
          await fetchSuggestions(statusFilter);
        }}
      />
    </AppPageShell>
  );
}
