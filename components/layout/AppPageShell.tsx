import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface AppPageShellProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  width?: 'narrow' | 'medium' | 'default' | 'wide' | 'full';
}

interface AppPageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  iconContainerClassName?: string;
}

const SHELL_WIDTH_CLASSNAME: Record<NonNullable<AppPageShellProps['width']>, string> = {
  narrow: 'max-w-4xl',
  medium: 'max-w-5xl',
  default: 'max-w-6xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
};

export function AppPageShell({
  children,
  className,
  width = 'default',
  ...props
}: AppPageShellProps) {
  return (
    <div
      className={cn('mx-auto w-full space-y-6', SHELL_WIDTH_CLASSNAME[width], className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AppPageHeader({
  title,
  description,
  icon,
  actions,
  className,
  iconContainerClassName,
}: AppPageHeaderProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-white p-6 dark:bg-slate-900', className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className={cn('rounded-lg bg-brand-yellow/15 p-2 text-brand-yellow', iconContainerClassName)}>
              {icon}
            </div>
          ) : null}
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}
