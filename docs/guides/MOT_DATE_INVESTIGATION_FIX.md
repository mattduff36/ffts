# MOT Due Date Investigation & Fix - Jan 2026

## Problem Identified

Vehicle **FE24 TYO** (and 6 other FE24 vehicles) displayed an incorrect MOT due date:
- **Stored in DB:** 2026-02-28 ❌
- **Correct date:** 2027-03-20 ✅
- **Discrepancy:** ~1 year off (13 months early)

## Root Cause

When these vehicles were added in **October 2024**, the sync process encountered the following scenario:

1. **MOT API Call Failed** - Vehicle was brand new (March 2024 plate), MOT API likely didn't have the record yet
2. **DVLA Fallback Used** - Code fell back to calculating from DVLA's `monthOfFirstRegistration` 
3. **Calculation Bug** - The fallback code used the **first day of the month** instead of considering the actual registration date

### Code Analysis

From `app/api/admin/vehicles/route.ts` (lines 310-328):

```typescript
// FALLBACK: Calculate first MOT from DVLA monthOfFirstRegistration for very new vehicles
if (motApiError.includes('No MOT history found') && dvlaData.monthOfFirstRegistration) {
  const [year, month] = dvlaData.monthOfFirstRegistration.split('.');
  if (year && month) {
    const firstRegDate = new Date(parseInt(year), parseInt(month) - 1, 1);  // ⚠️ Uses DAY 1
    const firstMotDue = new Date(firstRegDate);
    firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
    
    const calculatedMotDue = firstMotDue.toISOString().split('T')[0];
    updates.mot_due_date = calculatedMotDue;
  }
}
```

**Problem:** Using day `1` of the month is inaccurate since DVLA only provides month/year precision.

**How 2026-02-28 was calculated:**
- Base date used: February 28, 2023 (or Feb 1, 2023 + timezone adjustment)
- + 3 years = February 28, 2026

**Why this is wrong:**
- FE24 is a **March 2024** plate
- Actual registration: **March 21, 2024** (from MOT API)
- Correct MOT due: **March 20, 2027**

## Affected Vehicles

**Fixed:**
- FE24 TYO ✅

**Still Need Fixing:**
- FE24 TYH
- FE24 TYK
- FE24 TYP
- FE24 TYT
- FE24 TYU
- AB12 CDE
- KS24 OGD
- KT24 PSX
- KT24 UPJ

All have **NEVER been synced** with the MOT API (`last_mot_api_sync` is NULL).

## Fix Applied

### Immediate Fix (FE24 TYO)
Ran manual sync script to fetch correct data from MOT API:

```bash
npx tsx scripts/fix-fe24tyo-mot-date.ts
```

**Result:**
- MOT API now returns correct data: `motTestDueDate: 2027-03-20`
- Database updated successfully
- Vehicle now shows correct date in UI

### Bulk Fix Required
Need to sync all remaining affected vehicles. The MOT API now has correct data for all of them.

## Long-Term Solution

### Option 1: Prioritise MOT API's motTestDueDate (RECOMMENDED)
The MOT API now returns a `motTestDueDate` field for new vehicles. Code already uses this correctly (lines 349-352):

```typescript
if (motExpiryData.motExpiryDate) {
  updates.mot_due_date = motExpiryData.motExpiryDate;  // This works correctly
  updates.mot_expiry_date = motExpiryData.motExpiryDate;
}
```

**This works!** The issue was that these vehicles were added when the MOT API didn't have the data yet.

### Option 2: Improve DVLA Fallback
If we still need the DVLA fallback for brand-new vehicles, improve it:

```typescript
// Use LAST day of month instead of first for better accuracy
const lastDayOfMonth = new Date(parseInt(year), parseInt(month), 0);
const firstMotDue = new Date(lastDayOfMonth);
firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
```

### Option 3: Use registrationDate from MOT API
The MOT API also provides `registrationDate` (even when no tests exist):

```typescript
else if (motRawData?.registrationDate && !motRawData.firstUsedDate) {
  // Use registrationDate as fallback
  const regDate = new Date(motRawData.registrationDate);
  const firstMotDue = new Date(regDate);
  firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
  updates.mot_due_date = firstMotDue.toISOString().split('T')[0];
}
```

## Action Items

- [x] Fix FE24 TYO
- [ ] Run bulk sync for remaining 8 vehicles with wrong dates
- [ ] Add `registrationDate` fallback to MOT sync logic
- [ ] Improve DVLA fallback to use last day of month
- [ ] Add validation: warn if MOT due date is more than 6 months different from plate year + 3

## Testing

Verified fix by:
1. Calling MOT API directly - confirmed it returns correct `motTestDueDate: 2027-03-20`
2. Running database query - confirmed update was successful
3. Checking vehicle history in UI - correct date now displays

## Scripts Created

Located in `scripts/`:
- `diagnose-mot-date.ts` - Diagnostic tool to check MOT API responses
- `check-vehicle-mot-data.ts` - Check database records
- `test-sync-flow.ts` - Test the sync logic flow
- `fix-fe24tyo-mot-date.ts` - Manual fix for specific vehicle
- `find-incorrect-mot-dates.ts` - Find all vehicles with suspicious dates
- `reconstruct-bad-calculation.ts` - Understand how wrong date was calculated

## Prevention

To prevent this in future:

1. **Retry Logic:** If MOT API fails for a new vehicle, retry after a few days
2. **Validation:** Alert if calculated MOT due date seems incorrect for the plate year
3. **Logging:** Log all MOT date calculations with source (API vs calculated)
4. **Monitoring:** Dashboard alert for vehicles with NULL `last_mot_api_sync`

---

**Investigation completed:** 7 January 2026  
**Issue priority:** Medium (affects display only, not safety critical)  
**Fix status:** Partial (1/9 vehicles fixed, bulk sync pending)

