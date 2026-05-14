'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  ChevronUp,
  ChevronDown,
  Building2,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react';
import type { Customer } from '../types';

interface CustomersTableProps {
  customers: Customer[];
  onRowClick: (customer: Customer) => void;
}

type SortField = 'company_name' | 'contact_name' | 'city' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

export function CustomersTable({ customers, onRowClick }: CustomersTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortField, setSortField] = useState<SortField>('company_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    let list = customers;

    if (statusFilter !== 'all') {
      list = list.filter(c => c.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.company_name.toLowerCase().includes(q) ||
        c.short_name?.toLowerCase().includes(q) ||
        c.contact_name?.toLowerCase().includes(q) ||
        c.contact_email?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.postcode?.toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      const aVal = (a[sortField] ?? '') as string;
      const bVal = (b[sortField] ?? '') as string;
      const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [customers, search, statusFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3 inline ml-1" />
    ) : (
      <ChevronDown className="h-3 w-3 inline ml-1" />
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Customer Status</p>
        <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'inactive'] as const).map(s => (
              <Button
                key={s}
                variant={statusFilter === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className={statusFilter === s
                  ? 'bg-brand-yellow text-slate-900 hover:bg-brand-yellow/90'
                  : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'
                }
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('company_name')}>
                Company {renderSortIcon('company_name')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('contact_name')}>
                Contact {renderSortIcon('contact_name')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Phone</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('city')}>
                Location {renderSortIcon('city')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                Status {renderSortIcon('status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground">
                  {search ? 'No customers match your search.' : 'No customers yet. Add your first customer to get started.'}
                </td>
              </tr>
            ) : (
              filtered.map(customer => (
                <tr
                  key={customer.id}
                  onClick={() => onRowClick(customer)}
                  className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{customer.company_name}</div>
                    {customer.short_name && customer.short_name !== customer.company_name && (
                      <div className="text-xs text-muted-foreground">{customer.short_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {customer.contact_name || <span className="text-muted-foreground">—</span>}
                    {customer.contact_job_title && (
                      <div className="text-xs text-muted-foreground">{customer.contact_job_title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{customer.contact_email || '—'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{customer.contact_phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {[customer.city, customer.postcode].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={
                      customer.status === 'active'
                        ? 'border-green-500/30 text-green-400 bg-green-500/10'
                        : 'border-slate-500/30 text-slate-400 bg-slate-500/10'
                    }>
                      {customer.status}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? 'No customers match your search.' : 'No customers yet.'}
          </div>
        ) : (
          filtered.map(customer => (
            <div
              key={customer.id}
              onClick={() => onRowClick(customer)}
              className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2 cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-brand-yellow" />
                  <span className="font-semibold text-white">{customer.company_name}</span>
                </div>
                <Badge variant="outline" className={
                  customer.status === 'active'
                    ? 'border-green-500/30 text-green-400 bg-green-500/10'
                    : 'border-slate-500/30 text-slate-400 bg-slate-500/10'
                }>
                  {customer.status}
                </Badge>
              </div>
              {customer.contact_name && (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <span>{customer.contact_name}</span>
                  {customer.contact_job_title && (
                    <span className="text-muted-foreground">• {customer.contact_job_title}</span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {customer.contact_email && (
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {customer.contact_email}</span>
                )}
                {customer.contact_phone && (
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.contact_phone}</span>
                )}
                {customer.city && (
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {customer.city}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
