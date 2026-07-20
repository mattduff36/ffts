'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  HelpCircle, 
  Loader2, 
  Plus,
  Edit,
  Trash2,
  FolderOpen,
  FileText,
  Eye,
  EyeOff,
  LockKeyhole,
} from 'lucide-react';
import { toast } from 'sonner';
import type { FAQCategory, FAQArticleWithCategory } from '@/types/faq';
import { ALL_MODULES, MODULE_DISPLAY_NAMES, type ModuleName } from '@/types/roles';

const PUBLIC_CATEGORY_GATE = 'public';

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  module_name: ModuleName | typeof PUBLIC_CATEGORY_GATE;
}

function getModuleGateLabel(moduleName: ModuleName | null): string {
  return moduleName ? MODULE_DISPLAY_NAMES[moduleName] : 'Public';
}

export default function FAQEditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission: canEditFaq, loading: permissionLoading } = usePermissionCheck('faq-editor', false);
  
  const [activeTab, setActiveTab] = useState('categories');

  useEffect(() => {
    const requestedTab = searchParams.get('tab') || 'categories';
    const validTabs = ['categories', 'articles'];
    if (validTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('categories');
    router.replace('/admin/faq?tab=categories', { scroll: false });
  }, [searchParams, router]);

  function handleTabChange(value: string) {
    setActiveTab(value);
    router.replace(`/admin/faq?tab=${value}`, { scroll: false });
  }
  
  // Categories state
  const [categories, setCategories] = useState<(FAQCategory & { article_count: number })[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  
  // Articles state
  const [articles, setArticles] = useState<FAQArticleWithCategory[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  
  // Category dialog
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FAQCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
    module_name: PUBLIC_CATEGORY_GATE,
  });
  const [savingCategory, setSavingCategory] = useState(false);
  
  // Article dialog
  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<FAQArticleWithCategory | null>(null);
  const [articleForm, setArticleForm] = useState({
    category_id: '',
    title: '',
    slug: '',
    summary: '',
    content_md: '',
    is_published: true,
    admin_only: false,
    sort_order: 0,
  });
  const [savingArticle, setSavingArticle] = useState(false);
  
  // Delete dialogs
  const [deleteCategoryDialog, setDeleteCategoryDialog] = useState<FAQCategory | null>(null);
  const [deleteArticleDialog, setDeleteArticleDialog] = useState<FAQArticleWithCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Redirect non-admins
  useEffect(() => {
    if (!permissionLoading && !canEditFaq) {
      router.push('/dashboard');
    }
  }, [permissionLoading, canEditFaq, router]);

  const fetchCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      const response = await fetch('/api/admin/faq/categories');
      const data = await response.json();
      
      if (data.success) {
        setCategories(data.categories);
      }
    } catch (error) {
      const errorContextId = 'admin-faq-fetch-categories-error';
      console.error('Error fetching categories:', error, { errorContextId });
      toast.error('Failed to load categories', { id: errorContextId });
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const fetchArticles = useCallback(async (categoryFilter: string) => {
    try {
      setLoadingArticles(true);
      const params = new URLSearchParams();
      if (categoryFilter !== 'all') {
        params.set('category_id', categoryFilter);
      }
      
      const response = await fetch(`/api/admin/faq/articles?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setArticles(data.articles);
      }
    } catch (error) {
      const errorContextId = 'admin-faq-fetch-articles-error';
      console.error('Error fetching articles:', error, { errorContextId });
      toast.error('Failed to load articles', { id: errorContextId });
    } finally {
      setLoadingArticles(false);
    }
  }, []);

  // Fetch data on mount
  useEffect(() => {
    if (canEditFaq) {
      fetchCategories();
    }
  }, [canEditFaq, fetchCategories]);

  // Refetch articles when filter changes
  useEffect(() => {
    if (canEditFaq) {
      fetchArticles(selectedCategoryFilter);
    }
  }, [selectedCategoryFilter, canEditFaq, fetchArticles]);

  // Category handlers
  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({
      name: '',
      slug: '',
      description: '',
      sort_order: categories.length,
      module_name: PUBLIC_CATEGORY_GATE,
    });
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: FAQCategory) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      sort_order: category.sort_order,
      module_name: category.module_name || PUBLIC_CATEGORY_GATE,
    });
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.slug.trim()) {
      toast.error('Name and slug are required', { id: 'admin-faq-category-validation-missing-fields' });
      return;
    }

    try {
      setSavingCategory(true);
      
      const url = editingCategory 
        ? `/api/admin/faq/categories/${editingCategory.id}`
        : '/api/admin/faq/categories';
      const categoryPayload = {
        ...categoryForm,
        module_name: categoryForm.module_name === PUBLIC_CATEGORY_GATE ? null : categoryForm.module_name,
      };
      
      const response = await fetch(url, {
        method: editingCategory ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryPayload),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(editingCategory ? 'Category updated' : 'Category created');
        setCategoryDialogOpen(false);
        fetchCategories();
      } else {
        throw new Error(data.error || 'Failed to save category');
      }
    } catch (error) {
      const errorContextId = 'admin-faq-save-category-error';
      console.error('Error saving category:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to save category', { id: errorContextId });
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryDialog) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/faq/categories/${deleteCategoryDialog.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Category deleted');
        setDeleteCategoryDialog(null);
        fetchCategories();
      } else {
        throw new Error(data.error || 'Failed to delete category');
      }
    } catch (error) {
      const errorContextId = 'admin-faq-delete-category-error';
      console.error('Error deleting category:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to delete category', { id: errorContextId });
    } finally {
      setDeleting(false);
    }
  };

  // Article handlers
  const openAddArticle = () => {
    setEditingArticle(null);
    setArticleForm({
      category_id: categories[0]?.id || '',
      title: '',
      slug: '',
      summary: '',
      content_md: '',
      is_published: true,
      admin_only: false,
      sort_order: 0,
    });
    setArticleDialogOpen(true);
  };

  const openEditArticle = (article: FAQArticleWithCategory) => {
    setEditingArticle(article);
    setArticleForm({
      category_id: article.category_id,
      title: article.title,
      slug: article.slug,
      summary: article.summary || '',
      content_md: article.content_md,
      is_published: article.is_published,
      admin_only: article.admin_only,
      sort_order: article.sort_order,
    });
    setArticleDialogOpen(true);
  };

  const handleSaveArticle = async () => {
    if (!articleForm.category_id || !articleForm.title.trim() || !articleForm.slug.trim() || !articleForm.content_md.trim()) {
      toast.error('Category, title, slug, and content are required', {
        id: 'admin-faq-article-validation-missing-fields',
      });
      return;
    }

    try {
      setSavingArticle(true);
      
      const url = editingArticle 
        ? `/api/admin/faq/articles/${editingArticle.id}`
        : '/api/admin/faq/articles';
      
      const response = await fetch(url, {
        method: editingArticle ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(articleForm),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(editingArticle ? 'Article updated' : 'Article created');
        setArticleDialogOpen(false);
        fetchArticles(selectedCategoryFilter);
      } else {
        throw new Error(data.error || 'Failed to save article');
      }
    } catch (error) {
      const errorContextId = 'admin-faq-save-article-error';
      console.error('Error saving article:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to save article', { id: errorContextId });
    } finally {
      setSavingArticle(false);
    }
  };

  const handleDeleteArticle = async () => {
    if (!deleteArticleDialog) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/faq/articles/${deleteArticleDialog.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Article deleted');
        setDeleteArticleDialog(null);
        fetchArticles(selectedCategoryFilter);
      } else {
        throw new Error(data.error || 'Failed to delete article');
      }
    } catch (error) {
      const errorContextId = 'admin-faq-delete-article-error';
      console.error('Error deleting article:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to delete article', { id: errorContextId });
    } finally {
      setDeleting(false);
    }
  };

  // Auto-generate slug from title
  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  if (permissionLoading) {
    return <PageLoader message="Loading FAQ admin..." />;
  }

  if (!canEditFaq) {
    return null;
  }

  return (
    <AppPageShell>
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <HelpCircle className="h-6 w-6 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              FAQ Editor
            </h1>
            <p className="text-muted-foreground">
              Manage FAQ categories and articles
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-100 dark:bg-slate-800 p-0">
          <TabsTrigger value="categories" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <FolderOpen className="h-4 w-4" />
            Categories
          </TabsTrigger>
          <TabsTrigger value="articles" className="gap-2 data-[state=active]:bg-brand-yellow data-[state=active]:text-slate-900">
            <FileText className="h-4 w-4" />
            Articles
          </TabsTrigger>
        </TabsList>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card className="">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-foreground">Categories</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Organize FAQ articles into categories
                  </CardDescription>
                </div>
                <Button onClick={openAddCategory} className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900 sm:w-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingCategories ? (
                <PanelLoader message="Loading FAQ categories..." className="py-8" />
              ) : categories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p>No categories yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-foreground">
                            {category.name}
                          </h3>
                          <Badge variant="secondary" className="text-xs">
                            {category.article_count} articles
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {getModuleGateLabel(category.module_name)}
                          </Badge>
                          {!category.is_active && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          /{category.slug}
                        </p>
                        {category.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {category.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditCategory(category)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteCategoryDialog(category)}
                          className="text-red-500 hover:text-red-600"
                          disabled={category.article_count > 0}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Articles Tab */}
        <TabsContent value="articles">
          <Card className="">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-foreground">Articles</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Manage FAQ content
                  </CardDescription>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                    <SelectTrigger className="w-full bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900 sm:w-48">
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={openAddArticle} 
                    className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900 sm:w-auto"
                    disabled={categories.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Article
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingArticles ? (
                <PanelLoader message="Loading FAQ articles..." className="py-8" />
              ) : articles.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p>No articles yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {articles.map((article) => (
                    <div
                      key={article.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-800"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-foreground truncate">
                            {article.title}
                          </h3>
                          {article.is_published ? (
                            <Eye className="h-4 w-4 text-green-500" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                          {article.admin_only ? (
                            <Badge variant="outline" className="border-amber-500/40 text-xs text-amber-600 dark:text-amber-300">
                              <LockKeyhole className="mr-1 h-3 w-3" />
                              Admin only
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {article.category?.name}
                          </Badge>
                          <span>/{article.slug}</span>
                        </div>
                        {article.summary && (
                          <p className="text-sm text-muted-foreground mt-1 truncate">
                            {article.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditArticle(article)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteArticleDialog(article)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingCategory ? 'Update category details' : 'Create a new FAQ category'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Name</Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => {
                  setCategoryForm({
                    ...categoryForm,
                    name: e.target.value,
                    slug: editingCategory ? categoryForm.slug : generateSlug(e.target.value),
                  });
                }}
                placeholder="Category name"
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Slug</Label>
              <Input
                value={categoryForm.slug}
                onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}
                placeholder="category-slug"
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Description (optional)</Label>
              <Textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                placeholder="Brief description"
                rows={2}
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Module Gate</Label>
              <Select
                value={categoryForm.module_name}
                onValueChange={(value) => {
                  setCategoryForm({
                    ...categoryForm,
                    module_name: value as CategoryFormState['module_name'],
                  });
                }}
              >
                <SelectTrigger className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900">
                  <SelectValue placeholder="Select module gate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PUBLIC_CATEGORY_GATE}>Public - all signed-in users</SelectItem>
                  {ALL_MODULES.map((moduleName) => (
                    <SelectItem key={moduleName} value={moduleName}>
                      {MODULE_DISPLAY_NAMES[moduleName]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Restricted categories are only returned to users with the selected module permission.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Sort Order</Label>
              <Input
                type="number"
                value={categoryForm.sort_order}
                onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: parseInt(e.target.value) || 0 })}
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCategory} disabled={savingCategory} className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900">
              {savingCategory ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Article Dialog */}
      <Dialog open={articleDialogOpen} onOpenChange={setArticleDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto bg-white dark:bg-slate-900 border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingArticle ? 'Edit Article' : 'Add Article'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingArticle ? 'Update article content' : 'Create a new FAQ article'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-muted-foreground">Category</Label>
                <Select 
                  value={articleForm.category_id} 
                  onValueChange={(v) => setArticleForm({ ...articleForm, category_id: v })}
                >
                  <SelectTrigger className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-muted-foreground">Sort Order</Label>
                <Input
                  type="number"
                  value={articleForm.sort_order}
                  onChange={(e) => setArticleForm({ ...articleForm, sort_order: parseInt(e.target.value) || 0 })}
                  className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Title</Label>
              <Input
                value={articleForm.title}
                onChange={(e) => {
                  setArticleForm({
                    ...articleForm,
                    title: e.target.value,
                    slug: editingArticle ? articleForm.slug : generateSlug(e.target.value),
                  });
                }}
                placeholder="Article title"
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Slug</Label>
              <Input
                value={articleForm.slug}
                onChange={(e) => setArticleForm({ ...articleForm, slug: e.target.value })}
                placeholder="article-slug"
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Summary (optional)</Label>
              <Input
                value={articleForm.summary}
                onChange={(e) => setArticleForm({ ...articleForm, summary: e.target.value })}
                placeholder="Brief summary shown in search results"
                className="bg-slate-50 dark:bg-slate-800 dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-muted-foreground">Content (Markdown)</Label>
              <Textarea
                value={articleForm.content_md}
                onChange={(e) => setArticleForm({ ...articleForm, content_md: e.target.value })}
                placeholder="# Heading&#10;&#10;Article content in markdown format..."
                rows={12}
                className="bg-slate-50 dark:bg-slate-800 font-mono text-sm dark:text-slate-100 text-slate-900"
              />
            </div>
            
            <div className="flex flex-wrap gap-5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={articleForm.is_published}
                  onCheckedChange={(checked) => setArticleForm({ ...articleForm, is_published: checked })}
                />
                <Label className="text-slate-700 dark:text-muted-foreground">Published</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={articleForm.admin_only}
                  onCheckedChange={(checked) => setArticleForm({ ...articleForm, admin_only: checked })}
                />
                <Label className="text-slate-700 dark:text-muted-foreground">
                  Admin and Super Admin only
                </Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setArticleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveArticle} disabled={savingArticle} className="bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900">
              {savingArticle ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingArticle ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Dialog */}
      <AlertDialog open={!!deleteCategoryDialog} onOpenChange={() => setDeleteCategoryDialog(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteCategoryDialog?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Article Dialog */}
      <AlertDialog open={!!deleteArticleDialog} onOpenChange={() => setDeleteArticleDialog(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Article</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteArticleDialog?.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteArticle}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}
