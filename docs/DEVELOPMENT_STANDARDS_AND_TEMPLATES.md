# Development Standards & Coding Templates
**Project:** Forest Farm Operations  
**Version:** 1.0  
**Date:** December 17, 2025  
**Status:** MANDATORY - All new code must follow these standards

---

## Table of Contents
1. [Notification Standards](#notification-standards)
2. [Data Fetching Standards](#data-fetching-standards)
3. [Form Handling Standards](#form-handling-standards)
4. [Error Handling Standards](#error-handling-standards)
5. [Component Templates](#component-templates)
6. [Page Templates](#page-templates)
7. [API Route Templates](#api-route-templates)
8. [File Organization](#file-organization)
9. [Naming Conventions](#naming-conventions)
10. [Code Review Checklist](#code-review-checklist)

---

## NOTIFICATION STANDARDS

### Rule: Use Sonner ONLY
**Never use:** `alert()`, `confirm()`, `window.alert`, `window.confirm`

### Import
```typescript
import { toast } from 'sonner';
```

### Success Notifications
```typescript
// Simple success
toast.success('Operation completed');

// With description
toast.success('Timesheet submitted', {
  description: 'Your timesheet has been sent to your manager for approval.',
});

// With duration
toast.success('Saved as draft', {
  duration: 3000,
});
```

### Error Notifications
```typescript
// Simple error
toast.error('Failed to save');

// With description and longer duration
toast.error('Failed to submit timesheet', {
  description: 'Please check your internet connection and try again.',
  duration: 5000,
});
```

### Warning/Info Notifications
```typescript
toast.info('Remember to submit your timesheet by Friday');

toast.warning('Your session will expire in 5 minutes');
```

### Confirmation Dialogs
**Never use `confirm()`. Use AlertDialog component instead.**

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

// Trigger
<Button onClick={() => {
  setItemToDelete(item);
  setDeleteDialogOpen(true);
}}>Delete</Button>

// Dialog
<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. This will permanently delete {itemToDelete?.name}.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={handleDelete}
        className="bg-red-600 hover:bg-red-700"
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### Modal Primary CTA Contrast
Primary action buttons inside dark `Dialog` / `AlertDialog` surfaces must use explicit foreground and background classes. Do not rely on the default `Button` theme tokens in modals, because page-level themes can make the CTA dark-on-dark.

```tsx
<DialogFooter>
  <Button type="button" variant="outline">
    Cancel
  </Button>
  <Button
    type="submit"
    className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-700 disabled:text-white disabled:opacity-70"
  >
    Save
  </Button>
</DialogFooter>
```

Before shipping a new modal, check the primary CTA in enabled and disabled states against the actual dark dialog background.

### Action Notifications (with buttons)
```typescript
toast.error('Failed to sync data', {
  description: 'Would you like to retry?',
  action: {
    label: 'Retry',
    onClick: () => retrySync(),
  },
  duration: 10000,
});
```

---

## DATA FETCHING STANDARDS

### Rule: Use React Query for ALL server data

### 1. Create Service Layer (Optional but Recommended)
```typescript
// services/inspections.service.ts
import { createClient } from '@/lib/supabase/client';
import { VanInspection } from '@/types/inspection';

export const inspectionsService = {
  async getAll(filters?: { userId?: string; status?: string }) {
    const supabase = createClient();
    let query = supabase
      .from('van_inspections')
      .select('*, van:vans(reg_number, nickname)')
      .order('inspection_date', { ascending: false });

    if (filters?.userId) {
      query = query.eq('user_id', filters.userId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as VanInspection[];
  },

  async getById(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('van_inspections')
      .select('*, van:vans(*), items:van_inspection_items(*)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async create(inspection: VanInspectionCreate) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('van_inspections')
      .insert(inspection)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, updates: VanInspectionUpdate) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('van_inspections')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from('van_inspections')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};
```

### 2. Create React Query Hooks
```typescript
// lib/hooks/useInspections.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { inspectionsService } from '@/services/inspections.service';

// Query hook
export function useInspections(filters?: { userId?: string; status?: string }) {
  return useQuery({
    queryKey: ['inspections', filters],
    queryFn: () => inspectionsService.getAll(filters),
    // Optional configuration
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000,   // Cache for 10 minutes
  });
}

// Single item query hook
export function useInspection(id: string) {
  return useQuery({
    queryKey: ['inspections', id],
    queryFn: () => inspectionsService.getById(id),
    enabled: !!id, // Only run if id exists
  });
}

// Create mutation hook
export function useCreateInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: inspectionsService.create,
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Inspection created successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to create inspection', {
        description: error.message,
      });
    },
  });
}

// Update mutation hook
export function useUpdateInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: VanInspectionUpdate }) =>
      inspectionsService.update(id, updates),
    onSuccess: (data, variables) => {
      // Update cache
      queryClient.setQueryData(['inspections', variables.id], data);
      // Invalidate list
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Inspection updated');
    },
    onError: (error: Error) => {
      toast.error('Failed to update inspection', {
        description: error.message,
      });
    },
  });
}

// Delete mutation hook
export function useDeleteInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: inspectionsService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Inspection deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete inspection', {
        description: error.message,
      });
    },
  });
}
```

### 3. Use Hooks in Components
```typescript
'use client';

import { useInspections, useDeleteInspection } from '@/lib/hooks/useInspections';
import { useAuth } from '@/lib/hooks/useAuth';

export default function InspectionsPage() {
  const { user, isManager } = useAuth();
  const [filters, setFilters] = useState({ status: 'all' });
  
  // Query
  const { data: inspections, isLoading, error } = useInspections({
    userId: isManager ? undefined : user?.id,
    status: filters.status === 'all' ? undefined : filters.status,
  });

  // Mutation
  const deleteMutation = useDeleteInspection();

  const handleDelete = async (id: string) => {
    // deleteMutation already handles success/error toasts
    await deleteMutation.mutateAsync(id);
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      {inspections?.map(inspection => (
        <InspectionCard
          key={inspection.id}
          inspection={inspection}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
```

### Never Do This (OLD WAY - DO NOT USE)
```typescript
// ❌ WRONG - Direct fetch in component
const fetchInspections = async () => {
  setLoading(true);
  try {
    const { data, error } = await supabase.from('inspections').select();
    if (error) throw error;
    setInspections(data);
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  fetchInspections();
}, []);
```

---

## FORM HANDLING STANDARDS

### Rule: Use react-hook-form + Zod validation

### 1. Define Zod Schema
```typescript
// lib/validation/schemas.ts
import { z } from 'zod';

export const createInspectionSchema = z.object({
  vehicle_id: z.string().uuid('Please select a vehicle'),
  inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  mileage: z.number().int().positive('Mileage must be positive'),
  comments: z.string().max(500, 'Comments must be less than 500 characters').optional(),
});

export type CreateInspectionInput = z.infer<typeof createInspectionSchema>;
```

### 2. Create Form Component
```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createInspectionSchema, CreateInspectionInput } from '@/lib/validation/schemas';
import { useCreateInspection } from '@/lib/hooks/useInspections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function CreateInspectionForm({ onSuccess }: { onSuccess?: () => void }) {
  const createMutation = useCreateInspection();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateInspectionInput>({
    resolver: zodResolver(createInspectionSchema),
    defaultValues: {
      inspection_date: new Date().toISOString().split('T')[0],
    },
  });

  const onSubmit = async (data: CreateInspectionInput) => {
    await createMutation.mutateAsync(data);
    reset();
    onSuccess?.();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Vehicle Select */}
      <div className="space-y-2">
        <Label htmlFor="vehicle_id">
          Vehicle <span className="text-red-500">*</span>
        </Label>
        <select
          id="vehicle_id"
          {...register('vehicle_id')}
          className="w-full rounded-md border px-3 py-2"
        >
          <option value="">Select a vehicle</option>
          {/* Load vehicles here */}
        </select>
        {errors.vehicle_id && (
          <p className="text-sm text-red-500">{errors.vehicle_id.message}</p>
        )}
      </div>

      {/* Date Input */}
      <div className="space-y-2">
        <Label htmlFor="inspection_date">
          Date <span className="text-red-500">*</span>
        </Label>
        <Input
          id="inspection_date"
          type="date"
          {...register('inspection_date')}
        />
        {errors.inspection_date && (
          <p className="text-sm text-red-500">{errors.inspection_date.message}</p>
        )}
      </div>

      {/* Mileage Input */}
      <div className="space-y-2">
        <Label htmlFor="mileage">
          Mileage <span className="text-red-500">*</span>
        </Label>
        <Input
          id="mileage"
          type="number"
          {...register('mileage', { valueAsNumber: true })}
        />
        {errors.mileage && (
          <p className="text-sm text-red-500">{errors.mileage.message}</p>
        )}
      </div>

      {/* Comments Textarea */}
      <div className="space-y-2">
        <Label htmlFor="comments">Comments</Label>
        <Textarea
          id="comments"
          {...register('comments')}
          placeholder="Optional comments..."
        />
        {errors.comments && (
          <p className="text-sm text-red-500">{errors.comments.message}</p>
        )}
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={isSubmitting || createMutation.isPending}
      >
        {isSubmitting ? 'Creating...' : 'Create Inspection'}
      </Button>
    </form>
  );
}
```

### Never Do This (OLD WAY - DO NOT USE)
```typescript
// ❌ WRONG - Manual validation
const [subject, setSubject] = useState('');

const handleSubmit = () => {
  if (!subject.trim()) {
    toast.error('Subject is required');
    return;
  }
  // ... more validation
};
```

---

## ERROR HANDLING STANDARDS

### 1. Centralized Logger
```typescript
// lib/utils/logger.ts
import { errorLogger } from '@/lib/utils/error-logger';

export const logger = {
  debug: (message: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${message}`, data);
    }
  },

  info: (message: string, data?: any) => {
    console.info(`[INFO] ${message}`, data);
  },

  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data);
  },

  error: (message: string, error?: any, componentName?: string) => {
    console.error(`[ERROR] ${message}`, error);
    errorLogger.logError({
      error: error instanceof Error ? error : new Error(message),
      componentName,
    });
  },
};
```

### 2. Use Logger Instead of Console
```typescript
// ✓ CORRECT
import { logger } from '@/lib/utils/logger';

try {
  const data = await fetchData();
  logger.info('Data fetched successfully');
} catch (error) {
  logger.error('Failed to fetch data', error, 'MyComponent');
}

// ❌ WRONG
try {
  const data = await fetchData();
  console.log('Data fetched');
} catch (error) {
  console.error('Error:', error);
}
```

### 3. Error Boundaries for Components
```typescript
// components/shared/ErrorBoundary.tsx
'use client';

import { Component, ReactNode } from 'react';
import { logErrorFromBoundary } from '@/lib/utils/error-logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    logErrorFromBoundary(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <h3 className="font-semibold text-red-900">Something went wrong</h3>
          <p className="text-sm text-red-700">{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

// Usage:
<ErrorBoundary>
  <ComplexComponent />
</ErrorBoundary>
```

---

## COMPONENT TEMPLATES

### Standard Component Structure
```typescript
'use client'; // Only if using client features (hooks, events)

// 1. Imports - organized by category
import { useState, useEffect } from 'react'; // React
import { useRouter } from 'next/navigation'; // Next.js
import { useAuth } from '@/lib/hooks/useAuth'; // Custom hooks
import { Button } from '@/components/ui/button'; // UI components
import { toast } from 'sonner'; // Third-party
import type { MyType } from '@/types/my-type'; // Types

// 2. Types/Interfaces
interface MyComponentProps {
  title: string;
  onSave?: (data: MyType) => void;
  children?: React.ReactNode;
}

// 3. Component
export function MyComponent({ title, onSave, children }: MyComponentProps) {
  // 3a. Hooks - in order of execution
  const router = useRouter();
  const { user } = useAuth();
  
  // 3b. State
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<MyType | null>(null);
  
  // 3c. Queries/Mutations
  const { data: items } = useItems();
  const createMutation = useCreateItem();
  
  // 3d. Effects
  useEffect(() => {
    // Effect logic
  }, [/* dependencies */]);
  
  // 3e. Handlers
  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Logic
      toast.success('Saved successfully');
      onSave?.(data);
    } catch (error) {
      logger.error('Save failed', error);
      toast.error('Failed to save');
    } finally {
      setIsLoading(false);
    }
  };
  
  // 3f. Guards/Early returns
  if (!user) return null;
  
  // 3g. Render
  return (
    <div className="space-y-4">
      <h1>{title}</h1>
      {children}
      <Button onClick={handleSave} disabled={isLoading}>
        {isLoading ? 'Saving...' : 'Save'}
      </Button>
    </div>
  );
}
```

---

## PAGE TEMPLATES

### List Page Template
```typescript
'use client';

import { useState, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { useItems, useDeleteItem } from '@/lib/hooks/useItems';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function ItemsContent() {
  // 1. Hooks
  const { user, isManager } = useAuth();
  const { isOnline } = useOfflineSync();
  const { hasPermission } = usePermissionCheck('items');
  
  // 2. State
  const [filters, setFilters] = useState({ status: 'all' });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);
  
  // 3. Data
  const { data: items, isLoading } = useItems({
    userId: isManager ? undefined : user?.id,
    status: filters.status === 'all' ? undefined : filters.status,
  });
  
  // 4. Mutations
  const deleteMutation = useDeleteItem();
  
  // 5. Handlers
  const openDeleteDialog = (item: Item) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };
  
  const handleDelete = async () => {
    if (!itemToDelete) return;
    await deleteMutation.mutateAsync(itemToDelete.id);
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };
  
  // 6. Guards
  if (!hasPermission) return null;
  
  // 7. Render
  return (
    <div className="space-y-6 max-w-6xl">
      {!isOnline && <OfflineBanner />}
      
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Items</CardTitle>
              <p className="text-muted-foreground">Manage your items</p>
            </div>
            <Link href="/items/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Item
              </Button>
            </Link>
          </div>
        </CardHeader>
      </Card>
      
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          {/* Filter components here */}
        </CardContent>
      </Card>
      
      {/* List */}
      {isLoading ? (
        <div>Loading...</div>
      ) : items?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">No items found</p>
            <Link href="/items/new">
              <Button>Create your first item</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items?.map(item => (
            <Card key={item.id}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDeleteDialog(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{itemToDelete?.name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ItemsContent />
    </Suspense>
  );
}
```

---

## API ROUTE TEMPLATES

### Standard API Route
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateRequest, IdParamsSchema, CreateItemSchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/utils/logger';

// GET /api/items
export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // 2. Get query params
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    
    // 3. Database query
    let query = supabase.from('items').select('*');
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // 4. Return response
    return NextResponse.json({ success: true, data });
    
  } catch (error) {
    logger.error('GET /api/items failed', error, 'ItemsAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/items
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // 2. Validate request body
    const validation = await validateRequest(request, CreateItemSchema);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }
    
    // 3. Database operation
    const { data, error } = await supabase
      .from('items')
      .insert({
        ...validation.data,
        user_id: user.id,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // 4. Return response
    return NextResponse.json({ success: true, data }, { status: 201 });
    
  } catch (error) {
    logger.error('POST /api/items failed', error, 'ItemsAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

## FILE ORGANIZATION

### Project Structure
```
ffts/
├── app/
│   ├── (auth)/              # Auth pages (login, change-password)
│   ├── (dashboard)/         # Protected pages
│   │   ├── inspections/
│   │   │   ├── [id]/        # Dynamic routes
│   │   │   ├── new/
│   │   │   └── page.tsx     # List page
│   │   └── layout.tsx       # Dashboard layout
│   ├── api/                 # API routes
│   │   ├── inspections/
│   │   │   ├── [id]/
│   │   │   │   ├── delete/
│   │   │   │   │   └── route.ts
│   │   │   │   └── pdf/
│   │   │   │       └── route.ts
│   │   │   └── route.ts
│   │   └── ...
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── features/            # Feature-specific components
│   │   ├── inspections/
│   │   ├── timesheets/
│   │   └── rams/
│   ├── shared/              # Shared business components
│   │   ├── forms/
│   │   ├── layout/
│   │   └── admin/
│   └── ui/                  # Design system components (shadcn)
├── lib/
│   ├── hooks/               # React hooks
│   ├── utils/               # Utility functions
│   ├── services/            # API service layer (optional)
│   ├── validation/          # Zod schemas
│   ├── config/              # Configuration
│   ├── supabase/            # Supabase clients
│   └── stores/              # Zustand stores
├── types/                   # TypeScript types
├── scripts/                 # Build/maintenance scripts
│   ├── migrations/
│   ├── seed/
│   ├── maintenance/
│   └── archived/
└── docs/                    # Documentation
```

---

## NAMING CONVENTIONS

### Files
- **Components:** PascalCase (e.g., `InspectionCard.tsx`)
- **Pages:** lowercase with hyphens (e.g., `inspections/page.tsx`)
- **Utilities:** camelCase (e.g., `date-utils.ts`)
- **Types:** lowercase with hyphens (e.g., `inspection-types.ts`)
- **Hooks:** camelCase starting with `use` (e.g., `useInspections.ts`)

### Variables & Functions
- **Variables:** camelCase (e.g., `const userName = ...`)
- **Functions:** camelCase (e.g., `function fetchData() {...}`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `const MAX_ITEMS = 100`)
- **React Components:** PascalCase (e.g., `function InspectionCard() {...}`)

### Types & Interfaces
- **Interfaces:** PascalCase with descriptive names (e.g., `interface UserProfile {...}`)
- **Types:** PascalCase (e.g., `type Status = 'draft' | 'submitted'`)
- **Props:** PascalCase ending with `Props` (e.g., `interface ButtonProps {...}`)

### CSS Classes
- Use Tailwind utility classes
- For custom classes, use kebab-case (e.g., `custom-button`)

---

## CODE REVIEW CHECKLIST

### Before Submitting PR

#### 1. Functionality ✓
- [ ] Feature works as expected
- [ ] All edge cases handled
- [ ] Error states handled gracefully
- [ ] Loading states shown appropriately

#### 2. Code Standards ✓
- [ ] Uses Sonner for all notifications (no alert/confirm)
- [ ] Uses React Query for all data fetching
- [ ] Uses react-hook-form + Zod for forms
- [ ] Uses centralized logger (no console.* directly)
- [ ] Follows component structure template
- [ ] Follows naming conventions

#### 3. TypeScript ✓
- [ ] No `any` types
- [ ] No `@ts-ignore` or `@ts-nocheck`
- [ ] All props properly typed
- [ ] Return types specified for functions

#### 4. Performance ✓
- [ ] No unnecessary re-renders
- [ ] Proper React Query cache configuration
- [ ] Images optimized
- [ ] Large lists virtualized if needed

#### 5. Accessibility ✓
- [ ] Semantic HTML used
- [ ] Labels on form inputs
- [ ] Keyboard navigation works
- [ ] ARIA attributes where needed

#### 6. Security ✓
- [ ] No exposed secrets
- [ ] User input sanitized
- [ ] Auth checks in place
- [ ] RLS policies verified

#### 7. Testing ✓
- [ ] Unit tests for complex logic
- [ ] Manual testing completed
- [ ] Tested on mobile
- [ ] Tested offline (if applicable)

#### 8. Documentation ✓
- [ ] JSDoc comments on public functions
- [ ] Complex logic explained
- [ ] README updated if needed
- [ ] Breaking changes documented

#### 9. Build ✓
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] No TypeScript errors
- [ ] No console warnings

---

## EXAMPLES OF GOOD vs BAD CODE

### Notifications
```typescript
// ❌ BAD
if (confirm('Are you sure?')) {
  deleteItem();
}
alert('Deleted!');

// ✓ GOOD
const confirmed = await openConfirmDialog({
  title: 'Delete Item',
  description: 'This action cannot be undone.',
});
if (confirmed) {
  await deleteItem();
  toast.success('Item deleted successfully');
}
```

### Data Fetching
```typescript
// ❌ BAD
const [loading, setLoading] = useState(false);
const [data, setData] = useState([]);

useEffect(() => {
  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from('items').select();
    setData(data);
    setLoading(false);
  };
  fetchData();
}, []);

// ✓ GOOD
const { data, isLoading } = useItems();
```

### Forms
```typescript
// ❌ BAD
const [name, setName] = useState('');
const [error, setError] = useState('');

const handleSubmit = () => {
  if (!name) {
    setError('Name is required');
    return;
  }
  // submit...
};

// ✓ GOOD
const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(itemSchema),
});

const onSubmit = (data) => {
  // submit...
};
```

### Error Handling
```typescript
// ❌ BAD
try {
  await fetchData();
} catch (error) {
  console.error(error);
}

// ✓ GOOD
try {
  await fetchData();
} catch (error) {
  logger.error('Failed to fetch data', error, 'DataComponent');
  toast.error('Failed to load data', {
    description: 'Please try again later.',
  });
}
```

---

## ENFORCEMENT

### Automated Checks
- **Linting:** ESLint will catch pattern violations
- **Type checking:** TypeScript compiler will catch type errors
- **Pre-commit hooks:** Enforce standards before commits
- **CI/CD:** All checks must pass before merge

### Manual Review
- All PRs require code review
- Reviewers must check against this checklist
- Non-compliant code must be fixed before merge

### Exceptions
- Exceptions require approval from tech lead
- Must be documented in code comments
- Must include justification and plan to fix

---

## QUESTIONS & SUPPORT

- **Questions:** Ask in team Slack channel
- **Clarifications:** Request from tech lead
- **Updates:** Standards evolve - check for latest version

**Last Updated:** December 17, 2025  
**Version:** 1.0  
**Maintainer:** Development Team

---

*These standards are mandatory for all new code. Existing code should be refactored to comply during feature work or dedicated refactor sprints.*
