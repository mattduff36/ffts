BEGIN;

DO $$
DECLARE
  v_column RECORD;
  v_row_count INTEGER;
  v_legacy_acronym TEXT := 'LOLO' || 'R';
BEGIN
  FOR v_column IN
    SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'character')
      AND c.is_generated = 'NEVER'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = replace(%I, %L, %L) WHERE %I LIKE %L',
      v_column.table_schema,
      v_column.table_name,
      v_column.column_name,
      v_column.column_name,
      v_legacy_acronym,
      'LOLER',
      v_column.column_name,
      '%' || v_legacy_acronym || '%'
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      RAISE NOTICE 'Replaced legacy LOLER typo in %.% column %: % row(s)',
        v_column.table_schema,
        v_column.table_name,
        v_column.column_name,
        v_row_count;
    END IF;
  END LOOP;

  FOR v_column IN
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('json', 'jsonb')
      AND c.is_generated = 'NEVER'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = replace(%I::text, %L, %L)::%s WHERE %I::text LIKE %L',
      v_column.table_schema,
      v_column.table_name,
      v_column.column_name,
      v_column.column_name,
      v_legacy_acronym,
      'LOLER',
      v_column.data_type,
      v_column.column_name,
      '%' || v_legacy_acronym || '%'
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      RAISE NOTICE 'Replaced legacy LOLER typo in %.% JSON column %: % row(s)',
        v_column.table_schema,
        v_column.table_name,
        v_column.column_name,
        v_row_count;
    END IF;
  END LOOP;
END $$;

UPDATE public.actions
SET title = regexp_replace(title, '\mLOLER\s+Inspection\M', 'LOLER THOROUGH EXAMINATION', 'gi')
WHERE title ~* '\mLOLER\s+Inspection\M';

UPDATE public.workshop_attachment_templates
SET
  name = 'LOLER THOROUGH EXAMINATION',
  description = COALESCE(
    description,
    'Yearly Lifting Operations and Lifting Equipment Regulations thorough examination.'
  )
WHERE LOWER(name) = 'loler';

DO $$
DECLARE
  v_template RECORD;
  v_source_version_id UUID;
  v_new_version_id UUID;
  v_next_version INTEGER;
  v_old_published_ids UUID[];
  v_source_section RECORD;
  v_source_field RECORD;
  v_new_section_id UUID;
  v_signoff_section_id UUID;
  v_field_index INTEGER;
  v_has_required_signoff BOOLEAN;
  v_legacy_acronym TEXT := 'LOLO' || 'R';
BEGIN
  FOR v_template IN
    SELECT id
    FROM public.workshop_attachment_templates
    WHERE LOWER(name) = 'loler thorough examination'
  LOOP
    SELECT v.id
    INTO v_source_version_id
    FROM public.workshop_attachment_template_versions v
    WHERE v.template_id = v_template.id
      AND v.status = 'published'
    ORDER BY v.version_number DESC
    LIMIT 1;

    IF v_source_version_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.workshop_attachment_template_sections s
      INNER JOIN public.workshop_attachment_template_fields name_field
        ON name_field.section_id = s.id
      INNER JOIN public.workshop_attachment_template_fields signature_field
        ON signature_field.section_id = s.id
      WHERE s.version_id = v_source_version_id
        AND name_field.field_key = 'inspector_name'
        AND name_field.field_type = 'text'
        AND name_field.is_required = TRUE
        AND signature_field.field_key = 'inspector_signature'
        AND signature_field.field_type = 'signature'
        AND signature_field.is_required = TRUE
    )
    INTO v_has_required_signoff;

    IF v_has_required_signoff THEN
      CONTINUE;
    END IF;

    SELECT ARRAY_AGG(id)
    INTO v_old_published_ids
    FROM public.workshop_attachment_template_versions
    WHERE template_id = v_template.id
      AND status = 'published';

    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM public.workshop_attachment_template_versions
    WHERE template_id = v_template.id;

    INSERT INTO public.workshop_attachment_template_versions (
      template_id,
      version_number,
      status
    )
    VALUES (
      v_template.id,
      v_next_version,
      'published'
    )
    RETURNING id INTO v_new_version_id;

    FOR v_source_section IN
      SELECT id, section_key, title, description, sort_order
      FROM public.workshop_attachment_template_sections
      WHERE version_id = v_source_version_id
      ORDER BY sort_order ASC, created_at ASC
    LOOP
      INSERT INTO public.workshop_attachment_template_sections (
        version_id,
        section_key,
        title,
        description,
        sort_order
      )
      VALUES (
        v_new_version_id,
        v_source_section.section_key,
        replace(v_source_section.title, v_legacy_acronym, 'LOLER'),
        CASE
          WHEN v_source_section.description IS NULL THEN NULL
          ELSE replace(v_source_section.description, v_legacy_acronym, 'LOLER')
        END,
        v_source_section.sort_order
      )
      RETURNING id INTO v_new_section_id;

      v_field_index := 0;

      FOR v_source_field IN
        SELECT
          field_key,
          label,
          help_text,
          field_type,
          is_required,
          options_json,
          validation_json
        FROM public.workshop_attachment_template_fields
        WHERE section_id = v_source_section.id
        ORDER BY sort_order ASC, created_at ASC
      LOOP
        v_field_index := v_field_index + 1;

        INSERT INTO public.workshop_attachment_template_fields (
          section_id,
          field_key,
          label,
          help_text,
          field_type,
          is_required,
          sort_order,
          options_json,
          validation_json
        )
        VALUES (
          v_new_section_id,
          v_source_field.field_key,
          replace(v_source_field.label, v_legacy_acronym, 'LOLER'),
          CASE
            WHEN v_source_field.help_text IS NULL THEN NULL
            ELSE replace(v_source_field.help_text, v_legacy_acronym, 'LOLER')
          END,
          v_source_field.field_type,
          v_source_field.is_required,
          v_field_index,
          v_source_field.options_json,
          v_source_field.validation_json
        );
      END LOOP;
    END LOOP;

    INSERT INTO public.workshop_attachment_template_sections (
      version_id,
      section_key,
      title,
      description,
      sort_order
    )
    SELECT
      v_new_version_id,
      'inspection_sign_off',
      'Inspection Sign-Off',
      'Inspector name and signature for the LOLER THOROUGH EXAMINATION.',
      COALESCE(MAX(sort_order), 0) + 1
    FROM public.workshop_attachment_template_sections
    WHERE version_id = v_new_version_id
    RETURNING id INTO v_signoff_section_id;

    INSERT INTO public.workshop_attachment_template_fields (
      section_id,
      field_key,
      label,
      field_type,
      is_required,
      sort_order
    )
    VALUES
      (v_signoff_section_id, 'inspector_name', 'Inspector Name', 'text', TRUE, 1),
      (v_signoff_section_id, 'inspector_signature', 'Inspector Signature', 'signature', TRUE, 2);

    IF v_old_published_ids IS NOT NULL AND array_length(v_old_published_ids, 1) > 0 THEN
      UPDATE public.workshop_attachment_template_versions
      SET status = 'archived'
      WHERE id = ANY(v_old_published_ids);
    END IF;
  END LOOP;
END $$;

UPDATE public.workshop_attachment_schema_snapshots snapshot
SET snapshot_json = jsonb_set(
  snapshot.snapshot_json,
  '{sections}',
  COALESCE(snapshot.snapshot_json->'sections', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'section_key', 'inspection_sign_off',
      'title', 'Inspection Sign-Off',
      'description', 'Inspector name and signature for the LOLER THOROUGH EXAMINATION.',
      'sort_order', 999,
      'fields', jsonb_build_array(
        jsonb_build_object(
          'field_key', 'inspector_name',
          'label', 'Inspector Name',
          'field_type', 'text',
          'is_required', true,
          'sort_order', 1
        ),
        jsonb_build_object(
          'field_key', 'inspector_signature',
          'label', 'Inspector Signature',
          'field_type', 'signature',
          'is_required', true,
          'sort_order', 2
        )
      )
    )
  )
)
FROM public.workshop_task_attachments attachment
INNER JOIN public.workshop_attachment_templates template
  ON template.id = attachment.template_id
WHERE snapshot.attachment_id = attachment.id
  AND attachment.status <> 'completed'
  AND LOWER(template.name) = 'loler thorough examination'
  AND snapshot.snapshot_json::text NOT ILIKE '%inspector_signature%';

COMMIT;
