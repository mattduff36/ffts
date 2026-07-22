import type { SubmitterSuggestion, Suggestion } from '@/types/faq';

export function toSubmitterSuggestion(suggestion: Suggestion): SubmitterSuggestion {
  return {
    id: suggestion.id,
    created_by: suggestion.created_by,
    title: suggestion.title,
    body: suggestion.body,
    page_hint: suggestion.page_hint,
    status: suggestion.status,
    created_at: suggestion.created_at,
    updated_at: suggestion.updated_at,
  };
}
