// FAQ and Suggestions Types

import type { ModuleName } from './roles';

export interface FAQCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  module_name: ModuleName | null;
  created_at: string;
  updated_at: string;
}

export interface FAQArticle {
  id: string;
  category_id: string;
  title: string;
  slug: string;
  summary: string | null;
  content_md: string;
  is_published: boolean;
  admin_only: boolean;
  sort_order: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface FAQArticleWithCategory extends FAQArticle {
  category: FAQCategory;
}

export type SuggestionStatus = 'new' | 'under_review' | 'planned' | 'completed' | 'declined';

export interface Suggestion {
  id: string;
  created_by: string;
  title: string;
  body: string;
  page_hint: string | null;
  status: SuggestionStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuggestionWithUser extends Suggestion {
  user?: {
    full_name: string | null;
    email?: string;
  };
}

export interface SuggestionUpdate {
  id: string;
  suggestion_id: string;
  created_by: string;
  old_status: SuggestionStatus | null;
  new_status: SuggestionStatus | null;
  note: string | null;
  created_at: string;
}

export interface SuggestionUpdateWithUser extends SuggestionUpdate {
  user?: {
    full_name: string | null;
  };
}

// API Request/Response Types

export interface CreateSuggestionRequest {
  title: string;
  body: string;
  page_hint?: string;
}

export interface UpdateSuggestionRequest {
  status?: SuggestionStatus;
  admin_notes?: string;
  note?: string; // For the update audit trail
}

export interface FAQSearchResult {
  articles: FAQArticleWithCategory[];
  total: number;
}

export interface CreateFAQCategoryRequest {
  name: string;
  slug: string;
  description?: string;
  sort_order?: number;
  module_name?: ModuleName | null;
}

export interface UpdateFAQCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
  module_name?: ModuleName | null;
}

export interface CreateFAQArticleRequest {
  category_id: string;
  title: string;
  slug: string;
  summary?: string;
  content_md: string;
  is_published?: boolean;
  admin_only?: boolean;
  sort_order?: number;
}

export interface UpdateFAQArticleRequest {
  category_id?: string;
  title?: string;
  slug?: string;
  summary?: string;
  content_md?: string;
  is_published?: boolean;
  admin_only?: boolean;
  sort_order?: number;
}

// Status display helpers
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  new: 'New',
  under_review: 'Under Review',
  planned: 'Planned',
  completed: 'Completed',
  declined: 'Declined',
};

export const SUGGESTION_STATUS_COLORS: Record<SuggestionStatus, string> = {
  new: 'bg-blue-500',
  under_review: 'bg-yellow-500',
  planned: 'bg-purple-500',
  completed: 'bg-green-500',
  declined: 'bg-slate-500',
};
