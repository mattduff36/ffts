# Testing Safety Rules

## ⚠️ CRITICAL: Test Scripts and Production Data

### The Problem

Test scripts in `scripts/testing/` use **hardcoded test values** that can corrupt real production data.

**Example:** `test-inspection-draft.ts` uses `current_mileage: 50000` which triggers database triggers that automatically update vehicle maintenance records.

### Incident Report: Example Vehicle Vehicle (AB12 CDE)

**Date:** January 16, 2026  
**Issue:** Vehicle mileage incorrectly set to 50,000 miles  
**Actual Mileage:** ~26,700 miles  
**Root Cause:** Unknown test script execution that set mileage to 50,000

**Impact:**
- Maintenance calculations became incorrect
- Service intervals showed wrong values
- Overdue tasks were incorrectly flagged

**Resolution:**
- Mileage restored to correct value (26,700)
- Test scripts reviewed for safety

### Rules for Test Scripts

1. **NEVER run test scripts against production database**
   - Test scripts should only run against local/test databases
   - Always check `NEXT_PUBLIC_SUPABASE_URL` before running

2. **Use realistic test data**
   - Don't use obvious test values like 50000, 99999, etc.
   - Use randomized values within realistic ranges

3. **Clean up after tests**
   - Always delete test data created by scripts
   - Never leave test records in production

4. **Add safety checks to test scripts**
   - Check for production URL and abort if detected
   - Require explicit confirmation for destructive operations

5. **Document test scripts**
   - Clearly mark files as TEST ONLY
   - Add warnings in script headers

### Recommended Script Header

```typescript
/**
 * ⚠️ TEST SCRIPT - DO NOT RUN IN PRODUCTION ⚠️
 * 
 * This script is for testing purposes only.
 * It uses hardcoded test values that will corrupt production data.
 * 
 * Run with: npx tsx scripts/testing/[script-name].ts
 */

// Safety check
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl?.includes('your-production-domain')) {
  console.error('❌ SAFETY CHECK FAILED');
  console.error('This test script cannot run against production database');
  process.exit(1);
}
```

### Database Triggers to Be Aware Of

1. **Mileage Auto-Update Trigger**
   - Location: `supabase/migrations/20251218_create_vehicle_maintenance_system.sql`
   - Function: `update_vehicle_maintenance_mileage()`
   - Trigger: Fires on INSERT/UPDATE of `vehicle_inspections.current_mileage`
   - Impact: **ALWAYS updates** `vehicle_maintenance.current_mileage` (even if lower)

2. **Status History Trigger**
   - Tracks changes to workshop task statuses
   - Creates audit trail in `status_history` table

3. **Updated_at Triggers**
   - Auto-updates `updated_at` columns on record changes

### Safe Testing Practices

1. **Use a separate test database**
   ```bash
   # Create .env.test
   NEXT_PUBLIC_SUPABASE_URL=https://your-test-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-test-key
   ```

2. **Use test user accounts**
   - Create dedicated test users
   - Never use real employee accounts in tests

3. **Use test vehicles**
   - Create vehicles with obvious test registrations (e.g., "TEST 123")
   - Mark them clearly in the database

4. **Run tests in isolation**
   - Don't mix test data with production data
   - Use transactions when possible

5. **Verify test cleanup**
   - Always check that test data was deleted
   - Use unique identifiers to find test records

### Scripts That Need Safety Updates

- [ ] `scripts/testing/test-inspection-draft.ts` - Uses 50000 mileage
- [ ] `scripts/seed/seed-sample-data.ts` - Uses random mileage 50000-150000
- [ ] `scripts/seed/seed-inspections-sql.ts` - Uses 50000 + random

### Action Items

1. Add production URL checks to all test scripts
2. Update test scripts to use realistic, randomized values
3. Create a separate test database for running tests
4. Document which scripts are safe for production vs test-only
5. Add pre-commit hooks to prevent accidental test script commits

---

**Last Updated:** January 16, 2026  
**Incident:** Example Vehicle mileage corruption  
**Status:** Rules documented, scripts need updates
