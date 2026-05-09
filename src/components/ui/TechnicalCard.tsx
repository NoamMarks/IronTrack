import React from 'react';
import { cn } from '../../lib/utils';

interface TechnicalCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glow?: 'primary' | 'accent' | 'danger' | 'warning' | 'none';
}

const glowMap = {
  primary: 'shadow-glow-primary',
  accent:  'shadow-glow-accent',
  danger:  'shadow-glow-danger',
  warning: 'shadow-glow-warning',
  none:    '',
};

export function TechnicalCard({
  children,
  className,
  onClick,
  glow = 'none',
}: TechnicalCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative bg-card border border-border overflow-hidden',
        'transition-shadow duration-300',
        glowMap[glow],
        onClick && 'cursor-pointer hover:border-primary/50',
        className,
      )}
    >
      {/* Corner brackets */}
      <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/60 pointer-events-none" />
      <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary/60 pointer-events-none" />
      <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary/60 pointer-events-none" />
      <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary/60 pointer-events-none" />
      {children}
    </div>
  );
}
