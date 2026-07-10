ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT,
  ADD COLUMN IF NOT EXISTS secondary_emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS secondary_emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS secondary_emergency_contact_relationship TEXT,
  ADD COLUMN IF NOT EXISTS employer_profile_notes TEXT;
