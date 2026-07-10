# Testing Safety Rules

## Critical: Test Scripts and Production Data

Test helpers can fire production triggers, update maintenance state, send email, or create workflow records. Treat every script as mutating unless its header and implementation prove otherwise.

## Rules for Test Scripts

1. **NEVER run test scripts against production database**
   - Test scripts should only run against local/test databases
   - Always check `NEXT_PUBLIC_SUPABASE_URL` before running

2. **Use deterministic fictional data**
   - Prefix test fleet identifiers with `ZZ99`.
   - Use `example.test` email addresses and fictional names.
   - Never copy production employee, customer, quote, or fleet values.

3. **Clean up after tests**
   - Always delete test data created by scripts
   - Never leave test records in production

4. **Add safety checks to test scripts**
   - Check for production URL and abort if detected
   - Require explicit confirmation for destructive operations

5. **Document test scripts**
   - Clearly mark files as TEST ONLY
   - Add warnings in script headers

## Recommended Script Header

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
const allowLiveDb = process.env.RUN_LIVE_DB_TESTS === 'true';
if (!allowLiveDb) {
  console.error('❌ SAFETY CHECK FAILED');
  console.error('Set RUN_LIVE_DB_TESTS=true only for an approved isolated target.');
  process.exit(1);
}
```

## Database Triggers to Be Aware Of

1. **Mileage Auto-Update Trigger**
   - Location: `supabase/migrations/20251218_create_vehicle_maintenance_system.sql`
   - Function: `update_vehicle_maintenance_mileage()`
   - Trigger: Fires on inspection mileage changes.
   - Impact: Can update maintenance mileage and service calculations.

2. **Status History Trigger**
   - Tracks changes to workshop task statuses
   - Creates audit trail in `status_history` table

3. **Updated_at Triggers**
   - Auto-updates `updated_at` columns on record changes

## Safe Testing Practices

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
   - Create vehicles with deterministic fictional registrations (for example, `ZZ99 TEST`)
   - Mark them clearly in the database

4. **Run tests in isolation**
   - Don't mix test data with production data
   - Use transactions when possible

5. **Verify test cleanup**
   - Always check that test data was deleted
   - Use unique identifiers to find test records

## Review Checklist

1. Add production URL checks to all test scripts
2. Use deterministic fictional values
3. Create a separate test database for running tests
4. Document which scripts are safe for production vs test-only
5. Confirm no generated test records remain

---

**Last Updated:** July 10, 2026
