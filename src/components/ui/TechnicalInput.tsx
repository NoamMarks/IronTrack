import { cn } from '../../lib/utils';

interface TechnicalInputProps {
  value: string;
  onChange: (val: string) => void;
  /** Final-value commit hook. Numeric cells use this to clamp [min, max] on
   *  blur — see `clampOnCommit` in lib/numericInput.ts. */
  onBlur?: (val: string) => void;
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
        'bg-transparent border-none outline-none focus:ring-0 text-foreground font-mono text-sm w-full placeholder:text-muted-foreground',
        readOnly && 'cursor-not-allowed opacity-80',
        className
      )}
    />
  );
}
