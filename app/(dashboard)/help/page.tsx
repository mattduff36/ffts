'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Search, 
  HelpCircle, 
  Lightbulb, 
  BookOpen, 
  Loader2,
  Send,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Settings,
  Download,
  RefreshCw,
  LogOut,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import type { FAQArticleWithCategory, FAQCategory, Suggestion } from '@/types/faq';
import type { ErrorReport } from '@/types/error-reports';
import type { ModuleName } from '@/types/roles';
import { ALL_MODULES } from '@/types/roles';
import Link from 'next/link';
import { MODULE_PAGES, getPageLabel, getPageUrl } from '@/lib/config/module-pages';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';
import { createStatusError, getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function checkStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return isStandalone || isIOSStandalone;
}

export default function HelpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, isAdmin, signOut } = useAuth(); // Get user info
  const supabase = useBrowserSupabaseClient();
  
  // FAQ state
  const [articles, setArticles] = useState<FAQArticleWithCategory[]>([]);
  const [categories, setCategories] = useState<FAQCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [faqLoadedOnce, setFaqLoadedOnce] = useState(false);
  const [isFaqRefreshing, setIsFaqRefreshing] = useState(false);
  const hasSkippedInitialDebounceRef = useRef(false);
  const hasStartedInitialFaqFetchRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Suggestion state
  const [suggestionTitle, setSuggestionTitle] = useState('');
  const [suggestionBody, setSuggestionBody] = useState('');
  const [suggestionPageHint, setSuggestionPageHint] = useState('');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [mySuggestions, setMySuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  
  // Error report state
  const [errorTitle, setErrorTitle] = useState('');
  const [errorDescription, setErrorDescription] = useState('');
  const [errorPageSelection, setErrorPageSelection] = useState('');
  const [submittingError, setSubmittingError] = useState(false);
  const [myErrors, setMyErrors] = useState<ErrorReport[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  
  // Active tab
  const [activeTab, setActiveTab] = useState('faq');
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const [cacheGuideOpen, setCacheGuideOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isTriggeringInstallPrompt, setIsTriggeringInstallPrompt] = useState(false);
  const [isRefreshingApp, setIsRefreshingApp] = useState(false);

  useEffect(() => {
    const requestedTab = searchParams.get('tab') || 'faq';
    const validTabs = ['faq', 'install', 'errors', 'suggest', 'my-suggestions'];
    if (validTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('faq');
    router.replace('/help?tab=faq', { scroll: false });
  }, [searchParams, router]);

  function handleTabChange(value: string) {
    setActiveTab(value);
    router.replace(`/help?tab=${value}`, { scroll: false });
  }

  useEffect(() => {
    setIsStandaloneApp(checkStandaloneMode());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsStandaloneApp(true);
      toast.success('App installed successfully');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallNow = useCallback(async () => {
    if (isStandaloneApp) {
      toast.info('This app is already installed on this device.');
      return;
    }

    if (!deferredInstallPrompt) {
      toast.info('No install prompt is available right now. Follow the browser steps below to install manually.');
      return;
    }

    try {
      setIsTriggeringInstallPrompt(true);
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);

      if (choice.outcome === 'accepted') {
        toast.success('Install started. Check your home screen/app list.');
        return;
      }

      toast.info('Install prompt dismissed. You can retry anytime from this tab.');
    } catch (error) {
      console.error('Failed to trigger install prompt:', error);
      toast.error('Could not open the install prompt. Follow manual browser steps below.');
    } finally {
      setIsTriggeringInstallPrompt(false);
    }
  }, [deferredInstallPrompt, isStandaloneApp]);

  const handleSignOutNow = useCallback(async () => {
    try {
      setIsSigningOut(true);
      const { error } = await signOut();
      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      console.error('Error signing out from help support action:', error);
      toast.error('Could not sign out. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut]);

  const handleRefreshAppNow = useCallback(async () => {
    try {
      setIsRefreshingApp(true);
      await forceAppRefresh({ redirectTo: '/dashboard' });
    } catch (error) {
      console.error('Error refreshing app from help support action:', error);
      setIsRefreshingApp(false);
      toast.error('Could not fully refresh the app. Please try again.');
    }
  }, []);
  
  // User permissions
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());

  const fetchFAQ = useCallback(async (query: string, category: string | null, isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setIsFaqRefreshing(true);
      }
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      
      const response = await fetch(`/api/faq?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setArticles(data.articles);
        setCategories(data.categories);
      }
    } catch (error) {
      const errorContextId = 'help-faq-fetch-error';
      console.error('Error fetching FAQ:', error, { errorContextId });
      toast.error('Failed to load FAQ content', { id: errorContextId });
    } finally {
      if (isInitialLoad) {
        setLoading(false);
        setFaqLoadedOnce(true);
      } else {
        setIsFaqRefreshing(false);
      }
    }
  }, []);

  const fetchMySuggestions = useCallback(async () => {
    try {
      setLoadingSuggestions(true);
      const { items } = await fetchAllPaginatedItems<Suggestion>('/api/suggestions', 'suggestions', {
        limit: 200,
        errorMessage: 'Failed to load suggestions',
      });
      setMySuggestions(items);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  const fetchMyErrors = useCallback(async () => {
    try {
      setLoadingErrors(true);
      const { items } = await fetchAllPaginatedItems<ErrorReport>('/api/error-reports', 'reports', {
        limit: 200,
        errorMessage: 'Failed to load error reports',
      });
      setMyErrors(items);
    } catch (error) {
      console.error('Error fetching error reports:', error);
    } finally {
      setLoadingErrors(false);
    }
  }, []);

  // Fetch user permissions
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) return;
      
      // Admin has full access by definition.
      if (isAdmin) {
        setUserPermissions(new Set(ALL_MODULES));
        return;
      }
      
      try {
        const response = await fetch('/api/me/permissions', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw createStatusError(data.error || 'Failed to load permissions', response.status);
        }

        setUserPermissions(new Set<ModuleName>((data.enabled_modules || []) as ModuleName[]));
      } catch (error) {
        if (!isAuthErrorStatus(getErrorStatus(error)) && !isNetworkFetchError(error)) {
          console.error('Error fetching permissions:', error);
        }
        setUserPermissions(new Set());
      }
    }
    fetchPermissions();
  }, [profile?.id, isAdmin, supabase]);

  // Fetch FAQ data on mount
  useEffect(() => {
    // Guard initial FAQ bootstrap from React StrictMode double-invocation in dev.
    if (hasStartedInitialFaqFetchRef.current) {
      return;
    }
    hasStartedInitialFaqFetchRef.current = true;
    fetchFAQ('', null, true);
  }, [fetchFAQ]);

  // Fetch user's suggestions when tab changes
  useEffect(() => {
    if (activeTab === 'my-suggestions') {
      fetchMySuggestions();
    }
  }, [activeTab, fetchMySuggestions]);

  // Fetch user's error reports when tab changes
  useEffect(() => {
    if (activeTab === 'my-errors') {
      fetchMyErrors();
    }
  }, [activeTab, fetchMyErrors]);

  // Debounced search
  useEffect(() => {
    if (!faqLoadedOnce) {
      return;
    }
    if (!hasSkippedInitialDebounceRef.current) {
      hasSkippedInitialDebounceRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      fetchFAQ(searchQuery, selectedCategory, false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, fetchFAQ, faqLoadedOnce]);

  // Filter categories based on user permissions
  const filteredCategories = useMemo(() => {
    if (isAdmin) {
      return categories;
    }
    
    // Filter categories based on module permissions
    return categories.filter(category => {
      // If category has no module requirement, show it to everyone
      if (!category.module_name) {
        return true;
      }
      
      // Check if user has permission to this module
      return userPermissions.has(category.module_name as ModuleName);
    });
  }, [categories, userPermissions, isAdmin]);

  // Filter articles to only show those in accessible categories
  const filteredArticles = useMemo(() => {
    const accessibleCategoryIds = new Set(filteredCategories.map(cat => cat.id));
    return articles.filter(article => accessibleCategoryIds.has(article.category_id));
  }, [articles, filteredCategories]);

  // Group filtered articles by category
  const articlesByCategory = useMemo(() => {
    const grouped: Record<string, FAQArticleWithCategory[]> = {};
    filteredArticles.forEach(article => {
      const catSlug = article.category?.slug || 'uncategorized';
      if (!grouped[catSlug]) {
        grouped[catSlug] = [];
      }
      grouped[catSlug].push(article);
    });
    return grouped;
  }, [filteredArticles]);

  // Handle suggestion submission
  const handleSubmitSuggestion = async () => {
    if (!suggestionTitle.trim() || !suggestionBody.trim()) {
      toast.error('Please fill in both title and description', { id: 'help-suggestion-validation-missing-fields' });
      return;
    }

    try {
      setSubmittingSuggestion(true);
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestionTitle.trim(),
          body: suggestionBody.trim(),
          page_hint: suggestionPageHint.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Suggestion submitted successfully!');
        setSuggestionTitle('');
        setSuggestionBody('');
        setSuggestionPageHint('');
        // Refresh suggestions list if on that tab
        if (activeTab === 'my-suggestions') {
          fetchMySuggestions();
        }
      } else {
        throw new Error(data.error || 'Failed to submit suggestion');
      }
    } catch (error) {
      const errorContextId = 'help-submit-suggestion-error';
      console.error('Error submitting suggestion:', error, { errorContextId });
      toast.error('Failed to submit suggestion', { id: errorContextId });
    } finally {
      setSubmittingSuggestion(false);
    }
  };

  // Handle error report submission
  const handleSubmitError = async () => {
    if (!errorTitle.trim() || !errorDescription.trim()) {
      toast.error('Please fill in both title and description', { id: 'help-error-report-validation-missing-fields' });
      return;
    }

    if (!errorPageSelection) {
      toast.error('Please select which page/feature this error relates to', { id: 'help-error-report-validation-missing-page' });
      return;
    }

    try {
      setSubmittingError(true);
      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: errorTitle.trim(),
          description: errorDescription.trim(),
          page_url: getPageUrl(errorPageSelection),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          additional_context: {
            current_url: typeof window !== 'undefined' ? window.location.href : undefined,
            selected_page: errorPageSelection,
            selected_page_label: getPageLabel(errorPageSelection),
          },
        }),
      });

      // Parse response body once, regardless of status
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('Failed to parse response from server');
      }

      // Check response status and handle errors
      if (!response.ok) {
        throw new Error(data?.error || `Server error (${response.status})`);
      }

      if (data && data.success) {
        toast.success('Error reported successfully!', {
          description: 'Admins have been notified and will investigate.'
        });
        setErrorTitle('');
        setErrorDescription('');
        setErrorPageSelection('');
        // Refresh error reports list if on that tab
        if (activeTab === 'my-errors') {
          fetchMyErrors();
        }
      } else {
        throw new Error(data?.error || 'Failed to submit error report');
      }
    } catch (error) {
      const errorContextId = 'help-submit-error-report-error';
      console.error('Error submitting error report:', error, { errorContextId });
      toast.error('Failed to submit error report', { id: errorContextId });
    } finally {
      setSubmittingError(false);
    }
  };

  // Render markdown content (simple version)
  const renderMarkdown = (content: string) => {
    // Simple markdown to HTML conversion
    return content
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-foreground">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3 text-foreground">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 text-foreground">$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/^(\d+)\. (.*$)/gim, '<li class="ml-4">$2</li>')
      .replace(/\n\n/g, '</p><p class="mb-3 text-foreground">')
      .replace(/\n/g, '<br/>');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-500';
      case 'under_review': return 'bg-yellow-500';
      case 'planned': return 'bg-purple-500';
      case 'completed': return 'bg-green-500';
      case 'declined': return 'bg-slate-500';
      default: return 'bg-slate-500';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'New';
      case 'under_review': return 'Under Review';
      case 'planned': return 'Planned';
      case 'completed': return 'Completed';
      case 'declined': return 'Declined';
      default: return status;
    }
  };

  const getErrorStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-red-500';
      case 'investigating': return 'bg-yellow-500';
      case 'resolved': return 'bg-green-500';
      default: return 'bg-slate-500';
    }
  };

  const getErrorStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return 'New';
      case 'investigating': return 'Investigating';
      case 'resolved': return 'Resolved';
      default: return status;
    }
  };

  if (!supabase) {
    return <PageLoader message="Loading help..." />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Help & FAQ
            </h1>
            <p className="text-muted-foreground">
              Find answers to common questions and submit suggestions
            </p>
          </div>
          <div className="hidden md:flex items-center justify-end">
            <Button
              type="button"
              onClick={() => void handleRefreshAppNow()}
              disabled={isRefreshingApp}
              title="Refresh App Now"
              className="h-16 w-24 md:h-[4.5rem] md:w-[6.75rem] flex-col items-center justify-center gap-1 border border-brand-yellow bg-brand-yellow p-1.5 text-slate-900 transition-colors hover:bg-brand-yellow-hover hover:text-slate-900 disabled:opacity-60"
            >
              {isRefreshingApp ? (
                <Loader2 className="h-5 w-5 md:h-6 md:w-6 animate-spin" />
              ) : (
                <RefreshCw className="h-5 w-5 md:h-6 md:w-6" />
              )}
              <span className="text-[10px] md:text-[11px] font-semibold leading-tight text-center">
                {isRefreshingApp ? 'Refreshing...' : 'Refresh App'}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full max-w-4xl grid-cols-5 bg-slate-100 dark:bg-slate-800 p-0">
          <TabsTrigger value="faq" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <BookOpen className="h-4 w-4" />
            FAQ
          </TabsTrigger>
          <TabsTrigger value="install" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <Download className="h-4 w-4" />
            Install App
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <AlertTriangle className="h-4 w-4" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="suggest" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <Lightbulb className="h-4 w-4" />
            Suggest
          </TabsTrigger>
          <TabsTrigger value="my-suggestions" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <CheckCircle2 className="h-4 w-4" />
            My Suggestions
          </TabsTrigger>
        </TabsList>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-6">
          {/* Search Bar */}
          <Card className="">
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search FAQ articles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              {isFaqRefreshing && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Updating FAQ results...
                </div>
              )}
              
              {/* Category Filter */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                  className={selectedCategory === null ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                >
                  All Categories
                </Button>
                {filteredCategories.map((category) => (
                  <Button
                    key={category.id}
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCategory(category.slug)}
                    className={selectedCategory === category.slug ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* FAQ Content */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-brand-yellow" />
            </div>
          ) : filteredArticles.length === 0 ? (
            <Card className="">
              <CardContent className="py-12 text-center">
                <HelpCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {searchQuery ? 'No articles found matching your search.' : 'No FAQ articles available yet.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Group by category if no specific category selected */}
              {selectedCategory === null ? (
                filteredCategories.map((category) => {
                  const catArticles = articlesByCategory[category.slug] || [];
                  if (catArticles.length === 0) return null;
                  
                  return (
                    <Card key={category.id} className="">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-foreground flex items-center gap-2">
                          <ChevronRight className="h-5 w-5 text-brand-yellow" />
                          {category.name}
                        </CardTitle>
                        {category.description && (
                          <CardDescription className="text-muted-foreground">
                            {category.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <Accordion type="single" collapsible className="w-full">
                          {catArticles.map((article) => (
                            <AccordionItem key={article.id} value={article.id}>
                              <AccordionTrigger className="text-left text-foreground hover:text-brand-yellow">
                                {article.title}
                              </AccordionTrigger>
                              <AccordionContent>
                                {article.summary && (
                                  <p className="text-muted-foreground mb-4 italic">
                                    {article.summary}
                                  </p>
                                )}
                                <div 
                                  className="prose prose-sm dark:prose-invert max-w-none"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content_md) }}
                                />
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card className="">
                  <CardContent className="pt-6">
                    <Accordion type="single" collapsible className="w-full">
                      {filteredArticles.map((article) => (
                        <AccordionItem key={article.id} value={article.id}>
                          <AccordionTrigger className="text-left text-foreground hover:text-brand-yellow">
                            {article.title}
                          </AccordionTrigger>
                          <AccordionContent>
                            {article.summary && (
                              <p className="text-muted-foreground mb-4 italic">
                                {article.summary}
                              </p>
                            )}
                            <div 
                              className="prose prose-sm dark:prose-invert max-w-none"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content_md) }}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Install App Tab */}
        <TabsContent value="install" className="space-y-6">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-brand-yellow" />
                Install TEMPLATE App
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Follow the steps for your device and browser. If the install prompt is available, use the button below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void handleInstallNow()}
                  disabled={isStandaloneApp || isTriggeringInstallPrompt}
                  className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
                >
                  {isTriggeringInstallPrompt ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Opening Install Prompt...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      {isStandaloneApp ? 'Already Installed' : 'Install Now'}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCacheGuideOpen(true)}
                  className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
                >
                  Guided Cache-Clear Steps
                </Button>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  <strong>Support tip:</strong> If the install prompt does not appear, use the manual browser steps below and then refresh this page.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">Android - Chrome</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                <li>Open TEMPLATE in Chrome and sign in.</li>
                <li>Tap the three-dot menu in the top-right corner.</li>
                <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
                <li>Confirm by tapping <strong>Install</strong>.</li>
                <li>Open the app from your home screen or app drawer.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">Android - Firefox</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                <li>Open TEMPLATE in Firefox and sign in.</li>
                <li>Tap the menu button (three dots).</li>
                <li>Tap <strong>Install</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Confirm the prompt to add it to your home screen.</li>
                <li>Launch TEMPLATE from the new home screen icon.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">iPhone/iPad - Safari</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                <li>Open TEMPLATE in Safari (not inside another browser tab view).</li>
                <li>Tap the <strong>Share</strong> button.</li>
                <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top-right corner.</li>
                <li>Open TEMPLATE from your home screen icon.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">iPhone/iPad - Chrome or Edge</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                <li>Open TEMPLATE in Chrome or Edge.</li>
                <li>Use the browser menu and choose <strong>Open in Safari</strong>.</li>
                <li>In Safari, tap <strong>Share</strong> and then <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> to finish installation.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Monitor className="h-5 w-5 text-brand-yellow" />
                Desktop - Chrome / Edge
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                <li>Open TEMPLATE in Chrome or Edge.</li>
                <li>Look for the install icon in the address bar (usually a monitor + down arrow).</li>
                <li>Click it and confirm <strong>Install</strong>.</li>
                <li>You can also use browser menu options: <strong>Install app</strong> / <strong>Apps</strong>.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">Quick Support Actions</CardTitle>
              <CardDescription className="text-muted-foreground">
                Use these when troubleshooting with users over the phone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void handleRefreshAppNow()}
                disabled={isRefreshingApp}
                className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
              >
                {isRefreshingApp ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {isRefreshingApp ? 'Refreshing App...' : 'Refresh App Now'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCacheGuideOpen(true)}
                className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
              >
                Guided Cache-Clear Steps
              </Button>
              <Button
                onClick={() => void handleSignOutNow()}
                disabled={isSigningOut}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isSigningOut ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing Out...
                  </>
                ) : (
                  <>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out Now
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors" className="space-y-6">
          {/* Report Error Form */}
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Report an Error
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Found a bug or issue? Let us know and we&apos;ll investigate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="error-title">
                  Error Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="error-title"
                  placeholder="Brief description of the error"
                  value={errorTitle}
                  onChange={(e) => setErrorTitle(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="error-description">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="error-description"
                  placeholder="What happened? What did you expect to happen? Steps to reproduce..."
                  value={errorDescription}
                  onChange={(e) => setErrorDescription(e.target.value)}
                  rows={5}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="error-page">
                  Page/Feature <span className="text-red-500">*</span>
                </Label>
                <Select value={errorPageSelection} onValueChange={setErrorPageSelection}>
                  <SelectTrigger id="error-page" className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900">
                    <SelectValue placeholder="Select which page/feature this error relates to" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {MODULE_PAGES.map((moduleGroup) => (
                      <SelectGroup key={moduleGroup.module}>
                        <SelectLabel>{moduleGroup.displayName}</SelectLabel>
                        {moduleGroup.subPages.map((page) => (
                          <SelectItem key={page.value} value={page.value}>
                            {page.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  <strong>Tip:</strong> Include any error messages, codes, or screenshots you saw. The more detail you provide, the faster we can fix it!
                </p>
              </div>

              <Button
                onClick={handleSubmitError}
                disabled={submittingError || !errorTitle.trim() || !errorDescription.trim() || !errorPageSelection}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {submittingError ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Error Report
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* My Errors */}
          <Card className="">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-foreground">
                    My Error Reports
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Track the status of your reported errors
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Link href="/admin/errors/manage">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Settings className="h-4 w-4" />
                      Manage All Errors
                    </Button>
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loadingErrors ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-red-500" />
                </div>
              ) : myErrors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p>You haven&apos;t reported any errors yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {myErrors.map((error) => (
                    <div 
                      key={error.id}
                      className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-medium text-foreground">
                            {error.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {error.description}
                          </p>
                          {error.page_url && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Page: {error.page_url}
                            </p>
                          )}
                        </div>
                        <Badge className={`${getErrorStatusColor(error.status)} text-white`}>
                          {getErrorStatusLabel(error.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Reported {new Date(error.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Submit Suggestion Tab */}
        <TabsContent value="suggest">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                Submit a Suggestion
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Have an idea to improve the app? We&apos;d love to hear it!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="suggestion-title">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="suggestion-title"
                  placeholder="Brief title for your suggestion"
                  value={suggestionTitle}
                  onChange={(e) => setSuggestionTitle(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-body">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="suggestion-body"
                  placeholder="Describe your suggestion in detail..."
                  value={suggestionBody}
                  onChange={(e) => setSuggestionBody(e.target.value)}
                  rows={5}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="suggestion-page">
                  Related Page/Feature (optional)
                </Label>
                <Input
                  id="suggestion-page"
                  placeholder="e.g., Timesheets, Inspections, Dashboard"
                  value={suggestionPageHint}
                  onChange={(e) => setSuggestionPageHint(e.target.value)}
                />
              </div>

              <Button
                onClick={handleSubmitSuggestion}
                disabled={submittingSuggestion || !suggestionTitle.trim() || !suggestionBody.trim()}
                className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900"
              >
                {submittingSuggestion ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Suggestion
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Suggestions Tab */}
        <TabsContent value="my-suggestions">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                My Suggestions
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Track the status of your submitted suggestions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSuggestions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-yellow" />
                </div>
              ) : mySuggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p>You haven&apos;t submitted any suggestions yet.</p>
                  <Button
                    variant="link"
                    onClick={() => setActiveTab('suggest')}
                    className="mt-2"
                  >
                    Submit your first suggestion
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {mySuggestions.map((suggestion) => (
                    <div 
                      key={suggestion.id}
                      className="p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-medium text-foreground">
                            {suggestion.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {suggestion.body}
                          </p>
                          {suggestion.page_hint && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Related to: {suggestion.page_hint}
                            </p>
                          )}
                        </div>
                        <Badge className={`${getStatusColor(suggestion.status)} text-white`}>
                          {getStatusLabel(suggestion.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Submitted {new Date(suggestion.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={cacheGuideOpen} onOpenChange={setCacheGuideOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Guided Cache and Site-Data Clear Steps</DialogTitle>
            <DialogDescription>
              Use these instructions with users when install/login/session issues persist. After clearing data, sign in again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm text-muted-foreground">
            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">Android - Chrome</h3>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open Chrome and visit TEMPLATE once.</li>
                <li>Tap the padlock/site icon in the address bar.</li>
                <li>Open <strong>Site settings</strong>.</li>
                <li>Tap <strong>Clear & reset</strong>, then confirm.</li>
                <li>Reload TEMPLATE and sign in again.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">Android - Firefox</h3>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open Firefox and go to TEMPLATE.</li>
                <li>Tap the site settings icon from the address bar/menu.</li>
                <li>Clear site data/cookies for this site.</li>
                <li>Close and reopen the tab, then sign in again.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">iPhone/iPad - Safari</h3>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open iOS <strong>Settings</strong> app.</li>
                <li>Go to <strong>Safari &gt; Advanced &gt; Website Data</strong>.</li>
                <li>Search for TEMPLATE domain and swipe/delete it.</li>
                <li>Reopen Safari, load TEMPLATE, and sign in again.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">Desktop - Chrome / Edge</h3>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open TEMPLATE in browser.</li>
                <li>Click the padlock icon next to the URL.</li>
                <li>Open site settings and clear stored data for this site.</li>
                <li>Hard refresh the page and sign in again.</li>
              </ol>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
