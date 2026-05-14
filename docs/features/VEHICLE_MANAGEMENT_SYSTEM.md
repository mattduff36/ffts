# Vehicle Management System

## Overview
A comprehensive vehicle management system for TemplateApp, allowing admins to manage fleet vehicles and categories, with employees able to add new vehicles during inspection creation.

## Features Implemented

### 1. Admin Vehicle Management
**Location**: `/admin/vehicles`

#### Capabilities:
- **View all vehicles** with:
  - Registration number
  - Category/type
  - Status (Active/Inactive)
  - Last inspector name
  - Last inspection date
- **Add new vehicles** with registration and category
- **Edit vehicles** (registration, category, status)
- **Delete vehicles** (with safety checks)
- **Search vehicles** by registration, category, or inspector name

#### Safety Features:
- Cannot delete vehicles with existing inspections
- Option to mark vehicles as inactive instead
- Duplicate registration prevention
- Confirmation dialogs for destructive actions

### 2. Category Management
**Location**: `/admin/vehicles` → Categories tab

#### Capabilities:
- **View all categories** with vehicle count
- **Add new categories** with name and description
- **Edit categories** (name, description)
- **Delete categories** (only if unused)

#### Built-in Categories:
- Truck
- Artic
- Trailer
- Van

### 3. Employee Vehicle Addition
**Location**: `/inspections/new` → Add New Vehicle dialog

#### Capabilities:
- Employees can add vehicles while creating inspections
- Select from existing categories (optional)
- Auto-selects newly added vehicle
- Registration validation

## Database Schema

### New Table: `vehicle_categories`
```sql
CREATE TABLE vehicle_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Updated Table: `vehicles`
Added `category_id`:
```sql
ALTER TABLE vehicles
ADD COLUMN category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL;
```

## API Endpoints

### Vehicles
- **GET** `/api/admin/vehicles` - List all vehicles with category and last inspector
- **POST** `/api/admin/vehicles` - Create new vehicle
- **PUT** `/api/admin/vehicles/[id]` - Update vehicle
- **DELETE** `/api/admin/vehicles/[id]` - Delete vehicle

### Categories
- **GET** `/api/admin/categories` - List all categories
- **POST** `/api/admin/categories` - Create new category
- **PUT** `/api/admin/categories/[id]` - Update category
- **DELETE** `/api/admin/categories/[id]` - Delete category

## UI/UX Features

### Admin Dashboard
- **Statistics Cards**:
  - Total Vehicles
  - Active Vehicles
  - Inactive Vehicles
  - Total Categories

- **Tabs**: Separate views for Vehicles and Categories
- **Search**: Real-time filtering across all vehicle fields
- **Consistent Design**: Matches `/admin/users` page styling

### Dialogs
- **Add Vehicle**: Registration + Category dropdown
- **Edit Vehicle**: Registration + Category + Status
- **Delete Vehicle**: Confirmation with vehicle details
- **Add Category**: Name + Description
- **Edit Category**: Name + Description
- **Delete Category**: Confirmation (disabled if in use)

## Navigation

### Admin Access
Added to navbar for admin users:
- Users
- **Vehicles** ← New

## Data Migration

### Migration Script
`supabase/add-vehicle-categories.sql`

**What it does**:
1. Creates `vehicle_categories` table
2. Adds `category_id` column to `vehicles`
3. Inserts default categories
4. Migrates existing `vehicle_type` data to categories
5. Sets up RLS policies
6. Adds indexes for performance

**To run**:
```sql
-- Execute in Supabase SQL Editor
-- File: supabase/add-vehicle-categories.sql
```

## TypeScript Types

### Updated: `types/database.ts`
- Added `vehicle_categories` table types
- Updated `vehicles` table to include `category_id`

### Vehicle Type (with relations)
```typescript
type Vehicle = {
  id: string;
  reg_number: string;
  vehicle_type: string | null;  // Legacy, kept for compatibility
  category_id: string | null;
  status: string;
  created_at: string;
  vehicle_categories?: {
    id: string;
    name: string;
  } | null;
  last_inspector?: string | null;
  last_inspection_date?: string | null;
};
```

## Security

### Row Level Security (RLS)
- **Everyone** can view categories
- **Admins only** can manage categories
- **All users** can create vehicles (inspections page)
- **Admins only** can update/delete vehicles (admin page)

### Validation
- Registration numbers converted to uppercase
- Duplicate registration prevention
- Category foreign key constraints
- Cannot delete categories in use
- Cannot delete vehicles with inspections

## User Flows

### Admin: Adding a Vehicle
1. Go to Admin → Vehicles
2. Click "Add Vehicle"
3. Enter registration (required)
4. Select category (optional)
5. Click "Add Vehicle"
6. Vehicle appears in list

### Admin: Managing Categories
1. Go to Admin → Vehicles → Categories tab
2. Click "Add Category"
3. Enter name (required) and description (optional)
4. Click "Add Category"
5. Category available for all vehicles

### Employee: Adding a Vehicle
1. Go to Inspections → New Inspection
2. Click vehicle dropdown
3. Select "Add New Vehicle"
4. Enter registration (required)
5. Select category (optional)
6. Click "Add Vehicle"
7. Vehicle auto-selected for inspection

## Stats Display

### Vehicle Counts
- **Total**: All vehicles (active + inactive)
- **Active**: Currently in use
- **Inactive**: Out of service
- **Categories**: Total category types

## Search Functionality

Searches across:
- ✓ Registration number
- ✓ Category name
- ✓ Last inspector name

Real-time filtering as you type.

## Last Inspector Feature

**How it works**:
- Queries `vehicle_inspections` table
- Finds most recent inspection per vehicle
- Joins with `profiles` to get inspector name
- Shows date of last inspection
- Displays "No inspections" if vehicle never inspected

## Migration Steps (Deployment)

1. **Backup Database** (recommended)
2. **Run Migration**:
   ```bash
   # In Supabase SQL Editor
   # Execute: supabase/add-vehicle-categories.sql
   ```
3. **Verify Migration**:
   - Check `vehicle_categories` table exists
   - Check `vehicles.category_id` column exists
   - Check default categories inserted
4. **Deploy Application**
5. **Test**:
   - Admin can view/add/edit vehicles
   - Admin can manage categories
   - Employees can add vehicles in inspections

## Files Changed/Created

### New Files:
- `app/(dashboard)/admin/vehicles/page.tsx` - Main admin UI
- `app/api/admin/vehicles/route.ts` - Vehicle CRUD
- `app/api/admin/vehicles/[id]/route.ts` - Individual vehicle ops
- `app/api/admin/categories/route.ts` - Category CRUD
- `app/api/admin/categories/[id]/route.ts` - Individual category ops
- `supabase/add-vehicle-categories.sql` - Migration script

### Modified Files:
- `types/database.ts` - Added category types
- `components/layout/Navbar.tsx` - Added Vehicles link
- `app/(dashboard)/inspections/new/page.tsx` - Updated vehicle creation

## Testing Checklist

### Admin - Vehicles
- [ ] View list of vehicles
- [ ] See last inspector and date
- [ ] Add new vehicle
- [ ] Edit vehicle (reg, category, status)
- [ ] Try to delete vehicle with inspections (should fail)
- [ ] Delete vehicle without inspections
- [ ] Search for vehicles
- [ ] See statistics update correctly

### Admin - Categories
- [ ] View list of categories
- [ ] See vehicle count per category
- [ ] Add new category
- [ ] Edit category
- [ ] Try to delete category in use (should fail)
- [ ] Delete unused category

### Employee - Vehicle Creation
- [ ] Open inspections/new
- [ ] Click "Add New Vehicle"
- [ ] Add vehicle with category
- [ ] Add vehicle without category
- [ ] See vehicle auto-selected
- [ ] See vehicle in dropdown

## Future Enhancements (Optional)

- [ ] Vehicle maintenance tracking
- [ ] Service schedules
- [ ] Vehicle documents (MOT, insurance)
- [ ] Photo uploads
- [ ] Custom fields per category
- [ ] Bulk import vehicles
- [ ] Vehicle utilization reports
- [ ] QR codes for quick access
- [ ] Mileage history tracking
- [ ] Fuel consumption tracking

---

**Implementation Date**: October 30, 2025  
**Status**: ✅ Complete and Ready for Testing  
**Migration Required**: Yes - Run `add-vehicle-categories.sql`

