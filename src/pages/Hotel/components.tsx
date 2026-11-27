import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { statusLabel } from './helpers';

export function StatusBadge({ status }: { status: string }) {
  const variant = ['succeeded', 'completed', 'approved'].includes(status) ? 'success'
    : ['failed', 'rejected'].includes(status) ? 'destructive'
      : ['blocked', 'awaiting_approval', 'review', 'needs_review'].includes(status) ? 'warning'
        : 'secondary';
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

type FieldControlProps = { id?: string; 'aria-describedby'?: string };

export function Field({ label, children, hint, className }: { label: string; children: ReactElement<FieldControlProps>; hint?: string; className?: string }) {
  const generatedId = useId();
  const controlId = children.props.id || `hotel-field-${generatedId}`;
  const hintId = `${controlId}-hint`;
  const describedBy = [children.props['aria-describedby'], hint ? hintId : undefined]
    .filter(Boolean).join(' ') || undefined;

  return <div className={cn('block space-y-1.5 text-sm', className)}>
    <label htmlFor={controlId} className="block font-medium">{label}</label>
    {cloneElement(children, { id: controlId, 'aria-describedby': describedBy })}
    {hint && <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
  </div>;
}

export function Panel({ title, description, actions, children, className }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border bg-card', className)}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div className="space-y-1"><h2 className="font-semibold">{title}</h2>{description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}</div>
      {actions}
    </header>
    <div className="p-5">{children}</div>
  </section>;
}

export function Empty({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="flex flex-col items-center rounded-lg border border-dashed px-4 py-9 text-center">
    <Inbox className="mb-3 h-6 w-6 text-muted-foreground" />
    <p className="font-medium">{title}</p>
    {description && <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm leading-relaxed', error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200')}>
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 break-words">{children}</div>
  </div>;
}

export function SafeLink({ href, children }: { href: string; children?: ReactNode }) {
  const safe = /^https?:\/\//i.test(href);
  return safe ? <a href={href} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline underline-offset-2">{children ?? href}</a> : <span className="break-all">{children ? <>{children} · </> : null}{href}</span>;
}
