export type QuoteRamsActionStatus = 'open' | 'completed' | 'cancelled';

export type QuoteRamsEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';

export type QuoteRamsMutationName = 'accept' | 'reassign' | 'complete' | 'retry-email';

/** Quote-scoped RAMS action. Safe for the quote UI; no prices, customer, or scope. */
export interface QuoteRamsActionDto {
  id: string;
  quote_id: string;
  quote_reference: string;
  status: QuoteRamsActionStatus;
  assignee_profile_id: string;
  assignee_name: string | null;
  assigned_by: string | null;
  rams_document_id: string | null;
  requested_by: string | null;
  requested_at: string;
  completed_by: string | null;
  completed_at: string | null;
  confirmation_note: string | null;
  email_status: QuoteRamsEmailStatus;
  email_error: string | null;
}

/** Actions-panel row. Identifies the quote without the rest of the quote record. */
export interface QuoteRamsActionListItemDto {
  id: string;
  quote_id: string;
  quote_reference: string;
  status: QuoteRamsActionStatus;
  assignee_profile_id: string;
  assignee_name: string | null;
  email_status: QuoteRamsEmailStatus;
  requested_at: string;
  completed_at: string | null;
  rams_document_id: string | null;
}

export interface QuoteRamsEligibleManagerDto {
  profile_id: string;
  full_name: string | null;
  initials: string;
}

export interface QuoteRamsLinkedDocumentDto {
  id: string;
  title: string;
  document_type_name: 'RAMS';
}

export interface QuoteRamsContextResponse {
  action: QuoteRamsActionDto | null;
  eligible_managers: QuoteRamsEligibleManagerDto[];
  linked_documents: QuoteRamsLinkedDocumentDto[];
}

export interface QuoteRamsMutationRequest {
  action: QuoteRamsMutationName;
  manager_profile_id?: string | null;
  rams_document_id?: string | null;
  confirmation_note?: string | null;
}

export interface QuoteRamsMutationResponse {
  action: QuoteRamsActionDto;
  created: boolean;
  email_warning: string | null;
}

export interface QuoteRamsListResponse {
  actions: QuoteRamsActionListItemDto[];
}

export interface QuoteRamsErrorBody {
  error: string;
  code: string;
  field_errors?: Record<string, string>;
  eligible_managers?: QuoteRamsEligibleManagerDto[];
}
