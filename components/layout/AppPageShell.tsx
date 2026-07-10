import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface AppPageShellProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  width?: 'narrow' | 'medium' | 'default' | 'wide' | 'full';
}

interface AppPageHeaderProps {
  title: string;
  titleMeta?: ReactNode;
  description?: string;
  leading?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  headingClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  iconContainerClassName?: string;
  actionsClassName?: string;
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
  titleMeta,
  description,
  leading,
  icon,
  actions,
  className,
  contentClassName,
  headingClassName,
  titleClassName,
  descriptionClassName,
  iconContainerClassName,
  actionsClassName,
}: AppPageHeaderProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-white p-6 dark:bg-slate-900', className)}>
      <div className={cn('flex flex-col gap-4 md:flex-row md:items-start md:justify-between', contentClassName)}>
        <div className="flex min-w-0 items-start gap-3">
          {leading}
          {icon ? (
            <div className={cn('shrink-0 rounded-lg bg-brand-yellow/15 p-2 text-brand-yellow', iconContainerClassName)}>
              {icon}
            </div>
          ) : null}
          <div className={cn('min-w-0 space-y-1', headingClassName)}>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className={cn('break-words text-3xl font-bold text-foreground', titleClassName)}>{title}</h1>
              {titleMeta}
            </div>
            {description ? <p className={cn('text-sm text-muted-foreground', descriptionClassName)}>{description}</p> : null}
          </div>
        </div>
        {actions ? (
          <div className={cn('flex w-full min-w-0 flex-wrap gap-2 md:w-auto md:shrink-0 md:justify-end', actionsClassName)}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
