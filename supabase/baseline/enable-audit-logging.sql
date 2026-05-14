-- Enable Comprehensive Audit Logging
-- This script creates triggers to automatically track all changes to key tables
-- Run this in Supabase SQL Editor

-- =============================================
-- AUDIT LOG TRIGGER FUNCTION
-- =============================================

-- Function to log changes to audit_log table
CREATE OR REPLACE FUNCTION log_audit_changes()
RETURNS TRIGGER AS $$
DECLARE
  changes_json JSONB := '{}';
  old_data JSONB;
  new_data JSONB;
  field_name TEXT;
BEGIN
  -- Determine the action
  IF TG_OP = 'INSERT' THEN
    -- For INSERT, log all new values
    new_data := to_jsonb(NEW);
    FOR field_name IN SELECT jsonb_object_keys(new_data)
    LOOP
      IF field_name NOT IN ('created_at', 'updated_at') THEN
        changes_json := changes_json || jsonb_build_object(
          field_name, 
          jsonb_build_object('new', new_data->field_name)
        );
      END IF;
    END LOOP;
    
    INSERT INTO audit_log (table_name, record_id, user_id, action, changes)
    VALUES (
      TG_TABLE_NAME,
      NEW.id,
      auth.uid(),
      'created',
      changes_json
    );
    RETURN NEW;
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- For UPDATE, log changed fields with old and new values
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    
    FOR field_name IN SELECT jsonb_object_keys(new_data)
    LOOP
      IF field_name NOT IN ('created_at', 'updated_at') AND 
         (old_data->field_name IS DISTINCT FROM new_data->field_name) THEN
        changes_json := changes_json || jsonb_build_object(
          field_name,
          jsonb_build_object(
            'old', old_data->field_name,
            'new', new_data->field_name
          )
        );
      END IF;
    END LOOP;
    
    -- Only log if there were actual changes
    IF changes_json != '{}' THEN
      -- Determine specific action based on status changes
      DECLARE
        action_type TEXT := 'updated';
      BEGIN
        IF field_name = 'status' THEN
          IF new_data->>'status' = 'submitted' THEN
            action_type := 'submitted';
          ELSIF new_data->>'status' = 'approved' THEN
            action_type := 'approved';
          ELSIF new_data->>'status' = 'rejected' THEN
            action_type := 'rejected';
          END IF;
        END IF;
        
        INSERT INTO audit_log (table_name, record_id, user_id, action, changes)
        VALUES (
          TG_TABLE_NAME,
          NEW.id,
          auth.uid(),
          action_type,
          changes_json
        );
      END;
    END IF;
    RETURN NEW;
    
  ELSIF TG_OP = 'DELETE' THEN
    -- For DELETE, log all old values
    old_data := to_jsonb(OLD);
    FOR field_name IN SELECT jsonb_object_keys(old_data)
    LOOP
      IF field_name NOT IN ('created_at', 'updated_at') THEN
        changes_json := changes_json || jsonb_build_object(
          field_name,
          jsonb_build_object('old', old_data->field_name)
        );
      END IF;
    END LOOP;
    
    INSERT INTO audit_log (table_name, record_id, user_id, action, changes)
    VALUES (
      TG_TABLE_NAME,
      OLD.id,
      auth.uid(),
      'deleted',
      changes_json
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- APPLY AUDIT TRIGGERS TO KEY TABLES
-- =============================================

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS audit_timesheets ON timesheets;
DROP TRIGGER IF EXISTS audit_timesheet_entries ON timesheet_entries;
DROP TRIGGER IF EXISTS audit_vehicle_inspections ON vehicle_inspections;
DROP TRIGGER IF EXISTS audit_inspection_items ON inspection_items;
DROP TRIGGER IF EXISTS audit_absences ON absences;
DROP TRIGGER IF EXISTS audit_profiles ON profiles;
DROP TRIGGER IF EXISTS audit_vehicles ON vehicles;
DROP TRIGGER IF EXISTS audit_rams_documents ON rams_documents;

-- Create triggers for timesheets
CREATE TRIGGER audit_timesheets
  AFTER INSERT OR UPDATE OR DELETE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for timesheet_entries
CREATE TRIGGER audit_timesheet_entries
  AFTER INSERT OR UPDATE OR DELETE ON timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for vehicle_inspections
CREATE TRIGGER audit_vehicle_inspections
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_inspections
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for inspection_items
CREATE TRIGGER audit_inspection_items
  AFTER INSERT OR UPDATE OR DELETE ON inspection_items
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for absences (if table exists)
CREATE TRIGGER audit_absences
  AFTER INSERT OR UPDATE OR DELETE ON absences
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for profiles
CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for vehicles
CREATE TRIGGER audit_vehicles
  AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Create triggers for rams_documents (if table exists)
CREATE TRIGGER audit_rams_documents
  AFTER INSERT OR UPDATE OR DELETE ON rams_documents
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- =============================================
-- RLS POLICY FOR AUDIT LOG
-- =============================================

-- Enable RLS on audit_log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view all audit logs" ON audit_log
  FOR SELECT USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- System can always insert (triggers run as SECURITY DEFINER)
CREATE POLICY "System can insert audit logs" ON audit_log
  FOR INSERT WITH CHECK (true);

-- =============================================
-- TEST THE AUDIT LOGGING
-- =============================================

-- The audit logging is now active!
-- Any INSERT, UPDATE, or DELETE on tracked tables will be automatically logged
-- You can test it by making a change and checking the audit_log table

SELECT 'Audit logging enabled successfully! ✅' as status;

