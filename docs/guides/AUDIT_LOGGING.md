# Audit Logging System

## Overview

The Forest Farm Operations application includes a comprehensive audit logging system that automatically tracks all changes to key database tables. This enables administrators to monitor database modifications, troubleshoot issues, and maintain accountability.

## Features

### Automatic Change Tracking

The system automatically logs:
- **INSERT operations**: All new records with their initial values
- **UPDATE operations**: Changed fields with old and new values
- **DELETE operations**: Deleted records with their final values

### Tracked Tables

The following tables are monitored:
- `timesheets` - Timesheet submissions and status changes
- `timesheet_entries` - Individual timesheet day entries
- `van_inspections`, `plant_inspections`, and `hgv_inspections` - Daily-check forms
- asset-specific inspection item tables - Individual checklist items
- `absences` - Employee absence requests
- `profiles` - User profile changes
- `vans`, `hgvs`, and `plant` - Fleet record modifications
- `rams_documents` - RAMS document changes

### Captured Information

Each audit log entry includes:
- **Table Name**: Which table was modified
- **Record ID**: The UUID of the affected record
- **User ID**: Who made the change (from auth context)
- **Action**: Type of change (created, updated, deleted, submitted, approved, rejected)
- **Changes**: JSONB object containing:
  - For inserts: All new field values
  - For updates: Old and new values for changed fields
  - For deletes: All field values before deletion
- **Timestamp**: When the change occurred

## Accessing Audit Logs

### SuperAdmin Debug Console

1. Log in as SuperAdmin (`admin@mpdee.co.uk`)
2. Navigate to `/debug`
3. Click the **"Audit Log"** tab
4. View the last 100 database changes

### Audit Log Display

Each entry shows:
- **Action icon** and colored indicator
- **Table name** and action type
- **User** who made the change
- **Timestamp** (DD/MM/YYYY HH:MM:SS format)
- **Record ID** (truncated for display)
- **Detailed changes** showing old → new values with color coding:
  - 🔴 Red: Old values (removed/changed)
  - 🟢 Green: New values (added/changed)

## Database Schema

### audit_log Table

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Trigger Function

The `log_audit_changes()` function is executed automatically via AFTER triggers on all tracked tables. It runs with `SECURITY DEFINER` privileges to ensure system-level logging regardless of user permissions.

## Security

### Row Level Security (RLS)

- ✅ RLS is enabled on the `audit_log` table
- 🔐 Only users with `admin` role can view audit logs
- ✅ System can always insert logs (via triggers)

### Data Privacy

- Audit logs capture all field changes including sensitive data
- Access is restricted to SuperAdmin only
- Logs are retained indefinitely by default
- Consider implementing a retention policy for compliance

## Migration

### Initial Setup

The audit logging system was enabled using:

```bash
npx tsx scripts/run-audit-logging-migration.ts
```

This migration:
1. Creates the `log_audit_changes()` trigger function
2. Applies AFTER triggers to all tracked tables
3. Enables RLS on `audit_log`
4. Creates admin-only view policy

### Verification

Check that triggers are installed:

```sql
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name
FROM pg_trigger
WHERE tgname LIKE 'audit_%'
ORDER BY tgrelid::regclass::text;
```

## Use Cases

### Troubleshooting

- Identify when and by whom a record was modified
- Track status changes (draft → submitted → approved)
- Debug unexpected data changes

### Compliance & Accountability

- Maintain audit trail for regulatory compliance
- Investigate user actions
- Monitor system usage patterns

### Data Recovery

- Recover previous values after accidental changes
- Understand the history of a record
- Identify when data was deleted

## Best Practices

1. **Regular Review**: Periodically review audit logs for anomalies
2. **Performance**: Monitor audit_log table size; implement archival strategy
3. **Retention**: Define and implement a data retention policy
4. **Privacy**: Be aware that audit logs contain sensitive data
5. **Testing**: Test changes in development before production

## Future Enhancements

Potential improvements:
- Audit log search and filtering
- Export audit logs to CSV/JSON
- Automated alerts for specific changes
- Audit log retention policies
- User activity reports
- Change rollback capabilities

## Technical Notes

- Triggers execute in the same transaction as the main query
- Failed transactions will not create audit log entries
- System changes (e.g., migrations) may not have a user_id
- JSONB format allows flexible querying of changes
- Indexed on `(table_name, record_id)` for fast lookups

## Support

For issues or questions about audit logging:
1. Check the SuperAdmin Debug Console
2. Review this documentation
3. Examine the trigger function in the database
4. Contact system administrator

---

**Last Updated**: November 2025
**Migration Script**: `scripts/run-audit-logging-migration.ts`
**SQL File**: `supabase/enable-audit-logging.sql`

