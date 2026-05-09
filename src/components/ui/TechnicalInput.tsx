import { cn } from '../../lib/utils';

interface TechnicalInputProps {
  value: string;
  onChange: (val: string) => void;
  /** Final-value commit hook. Numeric cells use this to clamp [min, max] on
   *  blur — see `clampOnCommit` in lib/numericInput.ts. */
  onBlur?: (val: string) => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  type?: string;
  readOnly?: boolean;
  /** Hard cap on characters. Used by grid cells to prevent abuse. */
  maxLength?: number;
  /** Native browser tooltip — set this to `value` on truncating cells so a
   *  hover reveals the full text when text-overflow is ellipsised. */
  title?: string;
  /** Hint to mobile browsers about which keyboard to show. `decimal` is the
   *  big number pad on iOS/Android, ideal for weight + rep + RPE entry on
   *  the gym floor. Combine with `pattern="[0-9]*"` for legacy iOS support. */
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url' | 'search' | 'none';
  pattern?: string;
  autoComplete?: string;
  'aria-valuemin'?: number;
  'aria-valuemax'?: number;
  'data-testid'?: string;
}

export function TechnicalInput({
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  placeholder,
  className,
  type = 'text',
  readOnly = false,
  maxLength,
  title,
  inputMode,
  pattern,
  autoComplete,
  'aria-valuemin': ariaValueMin,
  'aria-valuemax': ariaValueMax,
  'data-testid': testId,
}: TechnicalInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      readOnly={readOnly}
      maxLength={maxLength}
      title={title}
      inputMode={inputMode}
      pattern={pattern}
      autoComplete={autoComplete}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      data-testid={testId}
      className={cn(
        'bg-transparent w-full',
        'border-b border-border',
        'text-foreground font-mono text-sm',
        'placeholder:text-muted-foreground/50',
        'transition-all duration-150',
        'focus:border-primary focus:outline-none',
        '[&:focus]:drop-shadow-[0_1px_4px_rgba(0,212,255,0.5)]',
        readOnly && 'opacity-50 cursor-not-allowed',
        className,
      )}
    />
  );
}
