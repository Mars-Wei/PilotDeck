import { BrainCircuit } from 'lucide-react';
import { cn } from '../../lib/utils';

type BrandLogoProps = {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  showText?: boolean;
};

export default function BrandLogo({
  className,
  iconClassName,
  textClassName,
  showText = true,
}: BrandLogoProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm',
          iconClassName,
        )}
      >
        <BrainCircuit className="h-[62%] w-[62%]" strokeWidth={1.75} />
      </span>
      {showText ? (
        <span
          className={cn(
            'truncate text-lg font-bold tracking-tight text-surface-900 dark:text-surface-100',
            textClassName,
          )}
        >
          OPC Brain
        </span>
      ) : null}
    </span>
  );
}
