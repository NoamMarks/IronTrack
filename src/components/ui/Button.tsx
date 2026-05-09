import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

const variants = {
  primary: [
    'border border-primary text-primary bg-transparent',
    'hover:bg-primary/10 hover:shadow-glow-primary',
    'active:scale-[0.97]',
  ].join(' '),
  ghost: [
    'border border-border text-muted-foreground bg-transparent',
    'hover:border-primary/50 hover:text-primary',
    'active:scale-[0.97]',
  ].join(' '),
  danger: [
    'border border-danger text-danger bg-transparent',
    'hover:bg-danger/10 hover:shadow-glow-danger',
    'active:scale-[0.97]',
  ].join(' '),
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'font-display font-semibold uppercase tracking-widest',
        'transition-all duration-150',
        'disabled:opacity-40 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
