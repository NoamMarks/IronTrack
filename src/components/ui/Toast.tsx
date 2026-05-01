import { CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ToastProps {
  /** When non-null the toast is visible. Set to null to hide. */
  message: string | null;
  /** Called when the user manually dismisses (clicks). Auto-dismiss timing
   *  is owned by the caller — typically a setTimeout that nulls `message`. */
  onDismiss?: () => void;
}

/**
 * Lightweight bottom-center toast. Renders into the React tree wherever it's
 * mounted but `position: fixed` so the visual placement is viewport-anchored.
 *
 * Exposes role="status" and data-testid="toast" so tests can locate it via
 * either accessibility role or testid.
 */
export function Toast({ message, onDismiss }: ToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="status"
          data-testid="toast"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={onDismiss}
          className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]',
            'flex items-center gap-2 px-5 py-3',
            'bg-accent text-accent-foreground',
            'rounded-input shadow-2xl',
            'font-mono text-xs uppercase tracking-widest',
            'cursor-pointer select-none',
          ].join(' ')}
        >
          <CheckCircle2 className="w-4 h-4" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
