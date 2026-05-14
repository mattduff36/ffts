'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Building2, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomersTable } from './components/CustomersTable';
import { CustomerFormDialog } from './components/CustomerFormDialog';
import type { Customer, CustomerFormData } from './types';

export default function CustomersPage() {
  const { hasPermission: canViewCustomers, loading: permissionLoading } = usePermissionCheck('customers', false);
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [pageTab, setPageTab] = useState<'overview' | 'settings'>('overview');

  const fetchCustomers = useCallback(async () => {
    try {
      const { items } = await fetchAllPaginatedItems<Customer>('/api/customers', 'customers', {
        limit: 500,
        errorMessage: 'Failed to fetch customers',
      });
      setCustomers(items);
    } catch (error) {
      const errorContextId = 'customers-fetch-list-error';
      console.error('Error fetching customers:', error, { errorContextId });
      toast.error('Failed to load customers', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionLoading) return;
    if (!canViewCustomers) {
      toast.error('Access denied', { id: 'customers-access-denied' });
      router.push('/dashboard');
      return;
    }
    fetchCustomers();
  }, [permissionLoading, canViewCustomers, router, fetchCustomers]);

  async function handleCreate(data: CustomerFormData) {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create customer');
    }
    toast.success('Customer added');
    await fetchCustomers();
  }

  async function handleUpdate(data: CustomerFormData) {
    if (!editingCustomer) return;
    const res = await fetch(`/api/customers/${editingCustomer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update customer');
    }
    toast.success('Customer updated');
    setEditingCustomer(null);
    await fetchCustomers();
  }

  function handleRowClick(customer: Customer) {
    router.push(`/customers/${customer.id}/history`);
  }

  if (permissionLoading || loading) {
    return <PageLoader message="Loading customers..." />;
  }

  return (
    <AppPageShell>
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-brand-yellow/10">
              <Building2 className="h-5 w-5 text-brand-yellow" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Customers</h1>
              <p className="text-muted-foreground">Manage your customer directory and key contact records.</p>
            </div>
          </div>
          <Button onClick={() => { setEditingCustomer(null); setFormOpen(true); }} className="bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90 font-semibold">
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>
      </div>

      <Tabs value={pageTab} onValueChange={(value) => setPageTab(value as 'overview' | 'settings')}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Building2 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-0">
          <CustomersTable
            customers={customers}
            onRowClick={handleRowClick}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 mt-0">
          <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">Customer Settings</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Customer settings will be added here in a later update.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <CustomerFormDialog
        open={formOpen || !!editingCustomer}
        onClose={() => { setFormOpen(false); setEditingCustomer(null); }}
        onSubmit={editingCustomer ? handleUpdate : handleCreate}
        customer={editingCustomer}
      />
    </AppPageShell>
  );
}
