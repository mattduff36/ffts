'use client';

import { LayoutGrid, Settings2, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';

export type DataViewMode = 'table' | 'cards';

interface DataViewToggleProps {
  value: DataViewMode;
  onValueChange: (value: DataViewMode) => void;
  className?: string;
}

interface ColumnVisibilityOption<TColumn extends string> {
  id: TColumn;
  label: string;
  checked: boolean;
}

interface ColumnVisibilityMenuProps<TColumn extends string> {
  options: ColumnVisibilityOption<TColumn>[];
  onToggle: (column: TColumn) => void;
  label?: string;
  className?: string;
  contentClassName?: string;
}

export function DataViewToggle({
  value,
  onValueChange,
  className,
}: DataViewToggleProps) {
  return (
    <div className={cn('flex items-center gap-1 bg-slate-800 rounded-lg p-0', className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onValueChange('table')}
        className={`h-8 px-3 ${value === 'table' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
      >
        <Table2 className="h-4 w-4 mr-1.5" />
        Table
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onValueChange('cards')}
        className={`h-8 px-3 ${value === 'cards' ? 'bg-white text-slate-900' : 'text-muted-foreground hover:text-white'}`}
      >
        <LayoutGrid className="h-4 w-4 mr-1.5" />
        Cards
      </Button>
    </div>
  );
}

export function ColumnVisibilityMenu<TColumn extends string>({
  options,
  onToggle,
  label = 'Toggle columns',
  className,
  contentClassName,
}: ColumnVisibilityMenuProps<TColumn>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('border-slate-600', className)}>
          <Settings2 className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn('w-56 bg-slate-900 border border-border', contentClassName)}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={option.checked}
            onCheckedChange={() => onToggle(option.id)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
