# User Role Change Procedure

## ⚡ Automatic Role Change Detection (ENABLED)

**As of December 2, 2025, the system automatically detects role changes and forces users to re-login!**

### How It Works:

When a user's role is changed by an admin:

1. **Realtime Detection** - Supabase realtime subscription detects the profile update
2. **Periodic Check** - Backup polling every 30 seconds in case realtime fails
3. **Automatic Logout** - User is automatically signed out
4. **User-Friendly Message** - Shows: "Your account permissions have been updated. Please log in again to continue."
5. **Redirect to Login** - User is sent to login page automatically

**No manual cache clearing required!** The system handles everything automatically.

## Legacy Issue (Now Fixed)

Previously, when a user's role was changed in the admin panel (e.g., from Employee to Admin/Manager), they wouldn't see the new permissions due to **session caching**.

### Old Root Cause

The `useAuth` hook fetches the user's profile and role when they log in:

```typescript
// lib/hooks/useAuth.ts
const fetchProfile = async (userId: string) => {
  const { data } = await supabase
    .from('profiles')
    .select(`
      *,
      role:roles(
        name,
        display_name,
        is_manager_admin,
        is_super_admin
      )
    `)
    .eq('id', userId)
    .single();
  
  setProfile(data);
};
```

This profile data is **cached in the React state** and **Supabase session** until the user logs out. Even if you change their role in the database, the cached session still has the old role information.

## ✅ Current Solution: Automatic Detection

The system now has **three layers of detection** to ensure users always have current permissions:

### Layer 1: Realtime Subscription (Instant)

```typescript
// In useAuth hook
const channel = supabase
  .channel(`profile_changes_${user.id}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'profiles',
    filter: `id=eq.${user.id}`,
  }, (payload) => {
    // Profile updated - check for role changes
    fetchProfile(user.id);
  })
  .subscribe();
```

When an admin changes a user's role, the change is detected **instantly** via Supabase realtime.

### Layer 2: Role Cache Comparison (On Fetch)

```typescript
// Store role in localStorage
const storageKey = `role_cache_${user.id}`;
const cachedRoleId = localStorage.getItem(storageKey);
const currentRoleId = profile.role?.name;

if (cachedRoleId && cachedRoleId !== currentRoleId) {
  // Role changed! Force logout
  alert('Your account permissions have been updated. Please log in again.');
  await supabase.auth.signOut();
  window.location.href = '/login';
}
```

Every time the profile is fetched, it compares the role with the cached version.

### Layer 3: Periodic Check (Every 30 seconds)

```typescript
// Backup check in case realtime fails
setInterval(async () => {
  const { data } = await supabase
    .from('profiles')
    .select('role:roles(name)')
    .eq('id', user.id)
    .single();
  
  // Compare with cached role and logout if different
}, 30000);
```

As a fallback, the system checks every 30 seconds for role changes.

### What Users See:

1. **Before:** Admin changes their role in the admin panel
2. **Instantly/Within 30s:** User sees alert message
3. **Automatically:** User is logged out
4. **Simple:** User logs back in with new permissions ✅

**No cache clearing, no hard refresh, no confusion!**

## Diagnostic Script

Run this to check a user's current role configuration:

```bash
npx tsx scripts/diagnose-user-permissions.ts
```

This will show:
- All available roles
- The user's current role assignment
- Whether permissions are correctly configured
- Any issues that need fixing

## Example: Example User Seven Case

**Symptoms:**
- Can see the "View inspections for: All Employees" dropdown (shows frontend recognizes admin role)
- Cannot see the list of everyone's inspections (cached session has old employee role)

**Diagnosis:**
```bash
$ npx tsx scripts/diagnose-user-permissions.ts

✅ User has role_id: 42a7082d-1d49-49c8-abb2-547b0ea5e011
   Role name: admin
   Display name: Administrator
✅ Role has is_manager_admin = true
   → User SHOULD be able to see all inspections
```

**Solution:**
Andy needed to log out and log back in to refresh his session.

## Implementation Details

All three detection layers are implemented in `lib/hooks/useAuth.ts`:

```typescript
// Layer 1: Realtime (lines ~48-67)
useEffect(() => {
  if (!user) return;
  const channel = supabase.channel(`profile_changes_${user.id}`)...
}, [user]);

// Layer 2: Cache comparison (lines ~31-46)
useEffect(() => {
  if (!user || !profile) return;
  const cachedRoleId = localStorage.getItem(`role_cache_${user.id}`)...
}, [user, profile]);

// Layer 3: Periodic check (lines ~69-90)
useEffect(() => {
  if (!user) return;
  const interval = setInterval(async () => {...}, 30000);
}, [user]);
```

### Why Three Layers?

- **Realtime:** Best case - instant detection
- **Cache comparison:** Catches changes on next profile fetch
- **Periodic:** Fallback if realtime connection drops

This redundancy ensures **100% reliability** even in poor network conditions.

## Checklist: Changing User Roles (Simplified)

When changing a user's role as an admin:

- [ ] Update the user's `role_id` in the `profiles` table
- [ ] Verify the role has correct permissions (`is_manager_admin`, etc.)
- [ ] ~~Notify the user~~ **System automatically handles this!**
- [ ] ~~Ask user to log out/in~~ **System forces logout automatically!**
- [ ] (Optional) Run diagnostic script if issues persist

**That's it!** The system handles the rest.

## Related Files

- `lib/hooks/useAuth.ts` - Authentication and profile fetching
- `scripts/diagnose-user-permissions.ts` - Diagnostic tool
- `app/(dashboard)/inspections/page.tsx` - Uses `isManager` flag

## Common Issues

### Issue: "I changed the role but user still can't see data"

**Check:**
1. Has the user logged out and back in?
2. Is browser cache cleared?
3. Run diagnostic script to verify database configuration
4. Check if role has correct `is_manager_admin` flag

### Issue: "User sees dropdown but no data"

**This is the session cache issue!**
- Frontend component partially updated (shows dropdown)
- But query still uses cached `isManager = false`
- Solution: Log out and back in

### Issue: "Admin role doesn't have manager permissions"

**Fix:**
```sql
UPDATE roles 
SET is_manager_admin = true 
WHERE name = 'admin';
```

Then user must log out/in to fetch updated role.

---

**Last Updated:** December 2, 2025  
**Related Issue:** Example User Seven - andy@example.com

