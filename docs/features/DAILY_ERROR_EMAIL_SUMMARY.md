# Daily Error Email Summary

**Feature:** Automatic daily email summary of application errors  
**Recipient:** template-admin@example.com (SuperAdmin)  
**Status:** ✅ Implemented

---

## Overview

The system automatically sends a comprehensive daily error summary email to the SuperAdmin. The email is triggered by the **first error of each new day**, ensuring you receive timely updates without the need for external cron jobs.

---

## How It Works

### Trigger Mechanism
1. **Error occurs** → Logged to `error_logs` table
2. **Error logger checks** → Is this the first error today?
3. **If yes** → Triggers `/api/errors/daily-summary` endpoint
4. **Email sent** → Summary of yesterday's errors

### Smart Detection
- Uses `localStorage` to track last email sent date
- Only sends once per day (first error of the day)
- Prevents duplicate emails
- No external scheduling required

---

## Email Content

The daily summary email includes:

### 📊 Summary Statistics
- Total error count for yesterday
- Number of unique error messages
- Date range covered

### 🏷️ Errors by Type
- Breakdown by error type (Error, TypeError, etc.)
- Count for each type
- Top 5 most common types

### 🧩 Errors by Component
- Which components/pages had errors
- Error count per component
- Top 5 affected components

### 👥 Most Affected Users
- Users who encountered the most errors
- Anonymous vs authenticated breakdown
- Top 5 affected users

### 🔝 Most Frequent Errors
- Top 10 most recurring error messages
- Occurrence count for each
- Helps identify systemic issues

### 🕐 Latest Errors (Last 5)
- Detailed view of most recent 5 errors
- Includes:
  - Error type and component
  - Full error message
  - User information (email or "Anonymous")
  - Page URL where error occurred
  - Timestamp

### 🔍 Action Button
- Direct link to `/debug` page
- Quick access to full error log
- View all errors with filtering options

---

## Technical Implementation

### API Endpoint
**Location:** `app/api/errors/daily-summary/route.ts`

**Method:** POST  
**Authentication:** None (internal use only)  
**Purpose:** Query yesterday's errors and send formatted email

**Response:**
```json
{
  "success": true,
  "message": "Daily error summary sent successfully",
  "errors_count": 20,
  "email_id": "abc-123-def",
  "summary": {
    "total_errors": 20,
    "unique_messages": 8,
    "top_error_type": "Error",
    "top_component": "Console Error"
  }
}
```

### Error Logger Integration
**Location:** `lib/utils/error-logger.ts`

**New Method:** `checkAndSendDailySummary()`

**Logic:**
```typescript
1. Check current date (YYYY-MM-DD format)
2. Compare with lastEmailSentDate from localStorage
3. If different date → Send email
4. Update lastEmailSentDate to today
5. Store in localStorage
```

**Storage:**
- Key: `lastErrorEmailSentDate`
- Value: `YYYY-MM-DD` (e.g., "2025-12-09")
- Location: Browser localStorage

---

## Email Service Configuration

### Provider: Resend
**API Endpoint:** `https://api.resend.com/emails`

### Required Environment Variable
```bash
RESEND_API_KEY=your_resend_api_key
```

### Email Configuration
```javascript
{
  from: 'DigiDocs <notifications@your-app.example.com>',
  to: ['template-admin@example.com'],
  subject: '🚨 Daily Error Summary - {count} errors on {date}',
  html: '...' // Formatted HTML email
}
```

---

## Setup Instructions

### 1. Configure Resend API Key

Add to `.env.local`:
```bash
RESEND_API_KEY=your_resend_api_key_here
```

### 2. Verify Domain (Resend)
- Go to Resend dashboard
- Add and verify domain: `your-app.example.com`
- Configure DNS records (SPF, DKIM)

### 3. Test Email System
```bash
# Manual test
curl -X POST https://your-app.example.com/api/errors/daily-summary

# Or via debug page
# Go to /debug → Click "Send Test Email" button (if implemented)
```

### 4. Verify localStorage
```javascript
// Check in browser console
localStorage.getItem('lastErrorEmailSentDate')
// Should return: "2025-12-09" (current date)
```

---

## Email Schedule

### When Emails Are Sent
- **Trigger:** First error logged after midnight
- **Covers:** All errors from previous day (00:00 - 23:59)
- **Frequency:** Once per day maximum
- **Time:** Varies (depends on when first error occurs)

### Example Timeline
```
Day 1:
- 00:00 - Midnight passes
- 08:30 - User encounters error (First error of day)
- 08:30 - Email sent with summary of Day 0 errors
- 10:15 - Another error occurs (Email NOT sent - already sent today)

Day 2:
- 00:00 - Midnight passes
- 09:45 - First error of new day
- 09:45 - Email sent with summary of Day 1 errors
```

---

## Advantages of This Approach

### ✅ Pros
1. **No external dependencies** - No cron jobs or schedulers needed
2. **Cost-effective** - Only sends when there are errors
3. **Timely notifications** - Sent shortly after first issue of the day
4. **Simple infrastructure** - Works with standard Next.js deployment
5. **Automatic** - No manual intervention required

### ⚠️ Considerations
1. **Timing varies** - Email time depends on first error (not fixed at 9am)
2. **Requires errors** - No email if zero errors (but that's a good thing!)
3. **Client-side tracking** - Uses localStorage (cleared if browser cache cleared)

---

## Alternative: Scheduled 9am Email

If you prefer a **fixed 9am daily email**, you can use:

### Option A: Vercel Cron
```typescript
// vercel.json
{
  "crons": [{
    "path": "/api/errors/daily-summary",
    "schedule": "0 9 * * *"
  }]
}
```

### Option B: External Cron Service
- Use cron-job.org or similar
- Schedule: `0 9 * * *` (9am daily)
- URL: `https://your-app.example.com/api/errors/daily-summary`
- Method: POST

### Option C: GitHub Actions
```yaml
name: Daily Error Summary
on:
  schedule:
    - cron: '0 9 * * *'
jobs:
  send-email:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Email
        run: curl -X POST https://your-app.example.com/api/errors/daily-summary
```

---

## Monitoring & Debugging

### Check if Email Was Sent
```javascript
// Browser console
const lastSent = localStorage.getItem('lastErrorEmailSentDate');
const today = new Date().toISOString().split('T')[0];
console.log('Last email sent:', lastSent);
console.log('Today:', today);
console.log('Should send today:', lastSent !== today);
```

### View Email Send Logs
- Check Resend dashboard for sent emails
- View API response in browser console
- Check server logs for send status

### Reset Email Tracking (Testing)
```javascript
// Force email to send on next error
localStorage.removeItem('lastErrorEmailSentDate');
```

### Test Email Content
```bash
# Trigger the API manually
curl -X POST https://your-app.example.com/api/errors/daily-summary \
  -H "Content-Type: application/json"
```

---

## Email Design

### Styling
- **Header:** Red gradient (matches brand)
- **Typography:** Clean, readable fonts
- **Sections:** Clearly separated with borders
- **Colors:** Red for errors, yellow for highlights
- **Mobile-responsive:** Works on all devices

### Accessibility
- High contrast text
- Proper heading hierarchy
- Descriptive alt text
- Screen reader friendly

---

## Future Enhancements

### Potential Improvements
1. **Weekly digest** - Summary of full week
2. **Error trends** - Compare to previous days
3. **Severity classification** - Critical vs minor errors
4. **Auto-resolution tracking** - Which errors were fixed
5. **Multiple recipients** - CC other team members
6. **Custom thresholds** - Only email if >X errors
7. **Slack integration** - Send to Slack channel
8. **Error categories** - Group by feature area

---

## Troubleshooting

### Email Not Sending

**1. Check Resend API Key**
```bash
echo $RESEND_API_KEY
# Should output: your_resend_api_key
```

**2. Verify Domain**
- Resend dashboard → Domains
- Status should be "Verified"

**3. Check localStorage**
```javascript
localStorage.getItem('lastErrorEmailSentDate')
// If today's date, remove it to force resend
```

**4. Check Logs**
- Browser console for client-side errors
- Server logs for API errors
- Resend dashboard for email delivery status

### Email Goes to Spam

**Solutions:**
1. Add `notifications@your-app.example.com` to contacts
2. Check SPF/DKIM records in DNS
3. Verify Resend domain authentication
4. Add to email whitelist

### Wrong Date Range

**Issue:** Email shows wrong day's errors  
**Cause:** Timezone mismatch  
**Fix:** Ensure server and client use same timezone

---

## Summary

✅ **Automatic daily error summaries**  
✅ **Triggered by first error of each day**  
✅ **Comprehensive email with charts and details**  
✅ **Sent to template-admin@example.com**  
✅ **No external dependencies required**  
✅ **Simple localStorage-based tracking**

**Status:** Ready for production use once `RESEND_API_KEY` is configured.

---

**Documentation Updated:** December 9, 2025  
**Implementation:** Complete  
**Testing Required:** Configure Resend API key and test
