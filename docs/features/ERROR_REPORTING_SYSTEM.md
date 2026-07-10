# Error Reporting System Implementation

**Date:** 2026-01-26  
**Type:** New Feature  
**Status:** Complete

## Overview

Added a user-facing error reporting system in the Help section where users can report bugs and errors. Super-admin users are notified via in-app notifications and email when errors are reported, and can manage reports through a dedicated admin interface.

## Features Implemented

### 1. User Error Reporting

**Location:** `/help` → "Errors" tab

Users can:
- Submit error reports with title and detailed description
- Optionally specify which page/feature the error relates to
- View all their previously submitted error reports ("My Errors")
- Track status of reports (New → Investigating → Resolved)

**Form Fields:**
- Error Title (required)
- Description (required) - supports detailed explanations, steps to reproduce
- Page/Feature (optional) - helps admins locate the issue

### 2. Admin Management

**Location:** `/errors/manage` (admin only)

Admins can:
- View all error reports across the system
- Filter by status (All, New, Investigating, Resolved)
- Search reports by title, description, user, or error code
- View detailed error information including:
  - Reporter name and contact
  - Error code, page URL, user agent
  - Additional context (JSON)
- Update report status and add internal notes
- View complete audit trail of status changes

**Status Workflow:**
- `new` → `investigating` → `resolved`

### 3. Notification System

When a user submits an error report:

**In-App Notifications:**
- Creates a high-priority REMINDER notification
- Sent to all users with `roles.name = 'admin'` OR `roles.is_super_admin = true`
- Appears in the bell icon notification inbox
- Includes full error details and link to management page

**Email Notifications:**
- Sends via Resend to all super-admin email addresses
- Professional HTML template with error details
- Includes "Manage Error Reports" button linking to admin page
- Batched sending for multiple admins (up to 10 per batch)

## Technical Implementation

### Database Schema

**Tables Created:**

```sql
error_reports
  - id (UUID primary key)
  - created_by (references auth.users)
  - title, description (TEXT, required)
  - error_code, page_url, user_agent (TEXT, optional)
  - additional_context (JSONB, optional)
  - status (new | investigating | resolved)
  - admin_notes (TEXT, internal use only)
  - resolved_at, resolved_by (tracking resolution)
  - notification_message_id (links to notification)
  - created_at, updated_at

error_report_updates
  - id (UUID primary key)
  - error_report_id (references error_reports)
  - created_by (references auth.users)
  - old_status, new_status (audit trail)
  - note (TEXT, optional)
  - created_at
```

**RLS Policies:**
- Users can view and create their own reports
- Admins can view, update all reports
- Admins can create update history entries
- Users can view update history on their own reports

**Migration File:** `supabase/migrations/20260126_error_reports.sql`

### API Endpoints

**User Endpoints:**
- `POST /api/errors/report` - Submit error report (enhanced existing endpoint)
  - Persists to database
  - Notifies all super-admins
  - Sends emails
  - Returns: `{ success, report_id, notification_sent, email_sent }`
- `GET /api/error-reports` - Get current user's reports

**Admin Endpoints:**
- `GET /api/management/error-reports` - List all reports with filters
  - Query params: `status=new|investigating|resolved`
  - Returns reports with user info and status counts
- `GET /api/management/error-reports/[id]` - Get report details + history
- `PATCH /api/management/error-reports/[id]` - Update status/notes
  - Creates audit trail entry
  - Auto-sets resolved_at/resolved_by when marked resolved

### Email Templates

**Function:** `sendErrorReportEmailToAdmins` in `lib/utils/email.ts`

- Multi-recipient support (all super-admins)
- Batched sending (10 emails per batch, 1s delay)
- Professional HTML template with:
  - Report title and description
  - Reporter information
  - Error code, page URL, user agent
  - Additional context (formatted JSON)
  - "Manage Error Reports" CTA button
  - Report ID for reference

### UI Components

**Help Page (`app/(dashboard)/help/page.tsx`):**
- Updated tabs layout from 3 to 4 columns
- Added "Errors" tab with:
  - Error report submission form
  - "My Errors" list with status badges
  - Admin shortcut button (visible to admins only)
- Integrated with existing Help/FAQ/Suggestions system

**Admin Management Page (`app/(dashboard)/errors/manage/page.tsx`):**
- Dashboard with status filter cards
- Search functionality
- Report list with status badges
- Detail dialog with:
  - Full error information display
  - Status update dropdown
  - Internal notes textarea
  - Update history timeline
  - Save button

### TypeScript Types

**File:** `types/error-reports.ts`

Exported types:
- `ErrorReport` - Base report type
- `ErrorReportWithUser` - Report with user details
- `ErrorReportUpdate` - Audit trail entry
- `ErrorReportUpdateWithUser` - Update with user details
- API request/response types
- Status constants and display helpers

## Security Considerations

1. **Admin-Only Access:**
   - Management APIs check `roles.name = 'admin'` OR `roles.is_super_admin = true`
   - Non-admins redirected from management page

2. **RLS Policies:**
   - Users can only see their own reports
   - Admins use modern roles table pattern (not deprecated `profiles.role`)
   - All policies include proper `WITH CHECK` clauses

3. **Service Role Usage:**
   - Error reporting endpoint uses service role to:
     - Find all super-admin users
     - Create notifications for super-admins
     - Send emails to super-admin addresses
   - User identity still verified via session

4. **Data Privacy:**
   - Admin notes not visible to reporters
   - User agent and additional context captured for debugging
   - Email addresses only used for notification, not exposed in UI

## Integration with Existing Systems

### Messages/Notifications System
- Reuses existing `messages` and `message_recipients` tables
- Type: `REMINDER`, Priority: `HIGH`
- Links to error report via `error_reports.notification_message_id`

### Resend Email Service
- Reuses existing Resend configuration
- Uses same email patterns as Toolbox Talks and other notifications
- Environment variables: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

### Error Logging
- Complements existing `error_logs` table (client-side errors)
- This system handles user-reported errors (manual submission)
- Both can be viewed in `/debug` page

## Files Created/Modified

### Created Files:
1. ✅ `supabase/migrations/20260126_error_reports.sql` - Database schema
2. ✅ `scripts/run-error-reports-migration.ts` - Migration runner
3. ✅ `types/error-reports.ts` - TypeScript types
4. ✅ `app/api/error-reports/route.ts` - User API
5. ✅ `app/api/management/error-reports/route.ts` - Admin list API
6. ✅ `app/api/management/error-reports/[id]/route.ts` - Admin detail/update API
7. ✅ `app/(dashboard)/errors/manage/page.tsx` - Admin management UI
8. ✅ `docs/features/ERROR_REPORTING_SYSTEM.md` - This documentation

### Modified Files:
1. ✅ `app/(dashboard)/help/page.tsx` - Added Errors tab
2. ✅ `app/api/errors/report/route.ts` - Enhanced to persist reports
3. ✅ `lib/utils/email.ts` - Added multi-admin email function

## Testing & Verification

### Manual Testing Steps

1. **User Flow:**
   - Go to `/help` → "Errors" tab
   - Submit an error report with title and description
   - Verify success message appears
   - Check "My Errors" shows the submitted report
   - Verify status shows as "New"

2. **Admin Flow:**
   - Check notification bell for new error report notification
   - Check admin email inbox for error report email
   - Go to `/errors/manage`
   - Verify new report appears in the list
   - Click report to open detail dialog
   - Update status to "Investigating"
   - Add internal notes
   - Add update note
   - Save changes
   - Verify history shows the update

3. **Multi-Admin Test:**
   - Create multiple admin accounts (if available)
   - Submit error report as regular user
   - Verify all super-admin accounts receive notification
   - Verify all super-admin email addresses receive email

### Database Verification

```bash
# Run migration
npx tsx scripts/run-error-reports-migration.ts

# Verify tables created
# Should show: error_reports, error_report_updates
# Should show: 7 RLS policies
```

### API Testing

```bash
# Test user error report submission
curl -X POST https://your-app.example.com/api/errors/report \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Error","description":"Test description"}'

# Test user reports list
curl https://your-app.example.com/api/error-reports

# Test admin reports list (requires admin auth)
curl https://your-app.example.com/api/management/error-reports

# Test admin update (requires admin auth)
curl -X PATCH https://your-app.example.com/api/management/error-reports/[id] \
  -H "Content-Type: application/json" \
  -d '{"status":"investigating","note":"Looking into this"}'
```

## Usage

### For Users

1. Navigate to Help & FAQ page
2. Click "Errors" tab
3. Fill in error details:
   - Clear, descriptive title
   - Detailed description including what you expected vs what happened
   - Related page/feature if known
4. Click "Submit Error Report"
5. Check "My Errors" to track status

### For Admins

1. Receive notification when error is reported
2. Click notification or navigate to `/errors/manage`
3. Review new error reports
4. Click a report to see full details
5. Update status as you investigate:
   - "New" → "Investigating" (when starting)
   - "Investigating" → "Resolved" (when fixed)
6. Add internal notes for tracking
7. Add update notes for history

## Performance Considerations

- Indexes on `created_by`, `status`, `created_at` for fast queries
- Batched email sending (10 per batch) to avoid rate limits
- RLS policies use proper JOIN patterns for optimal performance
- Update history stored separately to avoid bloating main table

## Future Enhancements

Potential improvements:
- Email notifications to reporter when status changes
- Priority levels for error reports
- Duplicate error detection/merging
- Integration with fixerrors tool
- Screenshot upload support
- Error report categories/tags

## Configuration

### Required Environment Variables

```bash
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL="Forest Farm Operations <noreply@your-app.example.com>"
```

### Admin Account Setup

Admins are identified by:
- `roles.name = 'admin'` OR
- `roles.is_super_admin = true`

To add more admins, update their role in the database or create new admin role assignments.

## Monitoring

### Key Metrics to Track

- Number of error reports submitted per day/week
- Average time to resolution
- Status distribution (new vs investigating vs resolved)
- Most common error types/pages
- Admin response time (created_at to first status update)

### Queries for Monitoring

```sql
-- Reports by status
SELECT status, COUNT(*) 
FROM error_reports 
GROUP BY status;

-- Recent unresolved reports
SELECT title, created_at, status
FROM error_reports
WHERE status != 'resolved'
ORDER BY created_at DESC
LIMIT 10;

-- Resolution time analysis
SELECT 
  AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_hours_to_resolve
FROM error_reports
WHERE resolved_at IS NOT NULL;
```

## Related Systems

- **Error Logs (`error_logs` table):** Automatic client-side error capture
- **Fixerrors Tool:** Automated error analysis and pattern matching
- **Debug Page:** Comprehensive error log viewer
- **Messages System:** In-app notifications
- **Resend:** Email notifications

## Summary

This feature provides a complete error reporting workflow:
- ✅ User-friendly reporting interface
- ✅ Persistent error tracking with status
- ✅ Dual notification (in-app + email)
- ✅ Admin management interface
- ✅ Complete audit trail
- ✅ Secure RLS policies
- ✅ Professional email templates

**Status:** Ready for production use
