# Vehicle Registration Number Standardization

## Overview

All vehicle registration numbers in the system follow a standardized format to ensure consistency across storage, display, and external API calls.

## Standards

### Database Storage
- **Format:** UK standard with space (e.g., `AA12 AAA`)
- **Case:** UPPERCASE
- **Whitespace:** Single space between position 4 and 5 for modern plates

**Examples:**
- ✅ `AB12 CDE`
- ✅ `XY34 ZZZ`
- ✅ `XYZ 123` (older format, preserved as-is)
- ❌ `AB12CDE` (no space - will be auto-formatted)
- ❌ `ab12 cde` (lowercase - will be auto-formatted)

### Frontend Display
- **Format:** Same as database (UK standard with space)
- **Source:** Direct from database `reg_number` field
- No additional formatting required

### External API Calls (DVLA, MOT)
- **Format:** NO spaces, UPPERCASE
- **Transformation:** Automatic via `formatRegistrationForApi()`

**Examples:**
- Database: `AB12 CDE` → API: `AB12CDE`

## Utility Functions

Located in `lib/utils/registration.ts`:

### `formatRegistrationForStorage(reg: string): string`
Formats a registration number for database storage.

```typescript
formatRegistrationForStorage("ab12cde")  // => "AB12 CDE"
formatRegistrationForStorage("AB12 CDE") // => "AB12 CDE"
formatRegistrationForStorage(" ab12  cde ") // => "AB12 CDE"
```

### `formatRegistrationForApi(reg: string): string`
Formats a registration number for external API calls (removes all spaces).

```typescript
formatRegistrationForApi("AB12 CDE")     // => "AB12CDE"
formatRegistrationForApi(" ab12  cde ") // => "AB12CDE"
```

### `validateRegistrationNumber(reg: string): string | null`
Validates a UK registration number format.

```typescript
validateRegistrationNumber("AB12 CDE")  // => null (valid)
validateRegistrationNumber("ABC")       // => "Invalid..." (too short)
validateRegistrationNumber("BC21@YZU")  // => "Invalid..." (special chars)
```

### `formatRegistrationForDisplay(reg: string): string`
Alias for `formatRegistrationForStorage` - ensures consistent display format.

## Implementation

### Van Creation (`POST /api/admin/vans`)
```typescript
const cleanReg = formatRegistrationForStorage(reg_number);
// Store in database with space
await supabase.from('vans').insert({ reg_number: cleanReg });
```

### Van Update (`PATCH /api/admin/vans/[id]`)
```typescript
if (reg_number !== undefined) {
  const validationError = validateRegistrationNumber(reg_number);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  updates.reg_number = formatRegistrationForStorage(reg_number);
}
```

### External API Calls
```typescript
// DVLA VES API
const regNumberNoSpaces = formatRegistrationForApi(vehicle.reg_number);
const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);

// MOT History API
const motData = await motService.getMotExpiryData(regNumberNoSpaces);
```

## Verification

The registration audit should confirm that modern plates use normalized uppercase spacing, legacy formats remain readable, and no normalized duplicates exist. Do not record live fleet counts or registrations in this guide.

**Files Updated:**
- `lib/utils/registration.ts` - New utility functions
- `app/api/admin/vans/route.ts` - Van creation
- `app/api/admin/vans/[id]/route.ts` - Van updates
- `app/api/admin/hgvs/route.ts` - HGV creation and updates
- `app/api/admin/plant/route.ts` - Plant creation and updates
- `app/api/maintenance/sync-dvla/route.ts` - DVLA sync
- `app/api/maintenance/sync-dvla-scheduled/route.ts` - Scheduled sync

## Benefits

1. **Consistency:** All registrations stored in same format
2. **No Duplicates:** Prevents `AB12CDE` and `AB12 CDE` being treated as different vehicles
3. **API Compatibility:** Automatic space removal for external APIs
4. **User-Friendly:** Display matches UK standard format
5. **Validation:** Catches invalid formats at entry point

## Testing

Run the audit script to check current database state:

```bash
npx tsx scripts/audit-registration-formats.ts
```

## Future Enhancements

- [ ] Add support for Northern Ireland format (e.g., `NIZ 1234`)
- [ ] Validate against DVLA plate format rules
- [ ] Add historical plate format detection (pre-2001)
- [ ] Implement plate format migration script if needed

---

**Last Updated:** 10 July 2026  
**Status:** ✅ Implemented and Audited

