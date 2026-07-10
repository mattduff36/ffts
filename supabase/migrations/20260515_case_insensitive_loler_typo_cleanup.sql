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
      'UPDATE %I.%I SET %I = regexp_replace(%I, %L, %L, %L) WHERE %I ~* %L',
      v_column.table_schema,
      v_column.table_name,
      v_column.column_name,
      v_column.column_name,
      v_legacy_acronym,
      'LOLER',
      'gi',
      v_column.column_name,
      v_legacy_acronym
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      RAISE NOTICE 'Case-insensitive legacy LOLER typo cleanup in %.% column %: % row(s)',
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
      'UPDATE %I.%I SET %I = regexp_replace(%I::text, %L, %L, %L)::%s WHERE %I::text ~* %L',
      v_column.table_schema,
      v_column.table_name,
      v_column.column_name,
      v_column.column_name,
      v_legacy_acronym,
      'LOLER',
      'gi',
      v_column.data_type,
      v_column.column_name,
      v_legacy_acronym
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      RAISE NOTICE 'Case-insensitive legacy LOLER typo cleanup in %.% JSON column %: % row(s)',
        v_column.table_schema,
        v_column.table_name,
        v_column.column_name,
        v_row_count;
    END IF;
  END LOOP;
END $$;

COMMIT;
