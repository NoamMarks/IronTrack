import * as Sentry from '@sentry/react';

function ErrorFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="relative border border-danger/40 bg-surface p-8 max-w-md w-full space-y-5">
        <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-danger/60 pointer-events-none" />
        <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-danger/60 pointer-events-none" />
        <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-danger/60 pointer-events-none" />
        <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-danger/60 pointer-events-none" />
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-danger/70">System Error</p>
        <p className="font-display font-bold uppercase text-2xl text-foreground">Something went wrong</p>
        <p className="font-mono text-sm text-muted-foreground leading-relaxed">
          An unexpected error occurred. It has been reported automatically. Try reloading — if it keeps happening, contact support.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 border border-primary text-primary font-mono text-xs uppercase tracking-widest hover:bg-primary/10 transition-colors"
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}

export const AppErrorBoundary = ({ children }: { children: React.ReactNode }) => (
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    {children}
  </Sentry.ErrorBoundary>
);
