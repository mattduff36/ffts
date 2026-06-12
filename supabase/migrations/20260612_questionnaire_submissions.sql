BEGIN;

CREATE TABLE IF NOT EXISTS public.questionnaire_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  answers JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT questionnaire_submissions_company_name_not_blank CHECK (LENGTH(BTRIM(company_name)) > 0),
  CONSTRAINT questionnaire_submissions_contact_name_not_blank CHECK (LENGTH(BTRIM(contact_name)) > 0),
  CONSTRAINT questionnaire_submissions_contact_email_not_blank CHECK (LENGTH(BTRIM(contact_email)) > 0),
  CONSTRAINT questionnaire_submissions_answers_is_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT questionnaire_submissions_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT questionnaire_submissions_email_status_check CHECK (
    email_status IN ('pending', 'sent', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS questionnaire_submissions_submission_number_idx
  ON public.questionnaire_submissions (submission_number);

CREATE INDEX IF NOT EXISTS questionnaire_submissions_created_at_idx
  ON public.questionnaire_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS questionnaire_submissions_contact_email_idx
  ON public.questionnaire_submissions (LOWER(BTRIM(contact_email)));

CREATE INDEX IF NOT EXISTS questionnaire_submissions_company_name_idx
  ON public.questionnaire_submissions (LOWER(BTRIM(company_name)));

DROP TRIGGER IF EXISTS set_updated_at_questionnaire_submissions ON public.questionnaire_submissions;
CREATE TRIGGER set_updated_at_questionnaire_submissions
  BEFORE UPDATE ON public.questionnaire_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.questionnaire_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS questionnaire_submissions_no_direct_client_access
  ON public.questionnaire_submissions;
CREATE POLICY questionnaire_submissions_no_direct_client_access
  ON public.questionnaire_submissions
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMIT;
