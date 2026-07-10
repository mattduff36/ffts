BEGIN;

-- FFTS is a production-only Forest Farm application. The questionnaire was
-- part of the reusable template handoff and has no production data contract.
DROP TABLE IF EXISTS public.questionnaire_submissions CASCADE;

COMMIT;
