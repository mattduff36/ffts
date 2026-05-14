CREATE OR REPLACE FUNCTION public.log_audit_changes()
RETURNS TRIGGER AS $$
DECLARE
  changes_json JSONB := '{}';
  old_data JSONB;
  new_data JSONB;
  field_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
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

    INSERT INTO public.audit_log (table_name, record_id, user_id, action, changes)
    VALUES (
      TG_TABLE_NAME,
      NEW.id,
      auth.uid(),
      'created',
      changes_json
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
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

    IF changes_json != '{}' THEN
      DECLARE
        action_type TEXT := 'updated';
      BEGIN
        IF changes_json ? 'status' THEN
          IF new_data->>'status' = 'submitted' THEN
            action_type := 'submitted';
          ELSIF new_data->>'status' = 'approved' THEN
            action_type := 'approved';
          ELSIF new_data->>'status' = 'rejected' THEN
            action_type := 'rejected';
          END IF;
        END IF;

        INSERT INTO public.audit_log (table_name, record_id, user_id, action, changes)
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

    INSERT INTO public.audit_log (table_name, record_id, user_id, action, changes)
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
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;
