import { useState, useMemo } from 'react';
import { Search, Eye, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { differenceInDays, formatDistanceToNow, parseISO } from 'date-fns';
import { TechnicalCard, Modal, Button } from '../ui';
import { cn } from '../../lib/utils';
import { checkPasswordStrength } from '../../lib/crypto';
import { isValidEmail, INVALID_EMAIL_MESSAGE } from '../../lib/validation';
import type { Client } from '../../types';

interface SuperadminViewProps {
  clients: Client[];
  onAddCoach: (name: string, email: string, password: string) => Promise<Client>;
  onImpersonate: (coach: Client) => void;
}

type Compliance = 'green' | 'amber' | 'red';
type GlowColor = 'accent' | 'warning' | 'danger';

interface CoachCompliance {
  status: Compliance;
  glow: GlowColor;
  dotClass: string;
  label: string;
}

function getCoachCompliance(lastActivity: string | null): CoachCompliance {
  if (!lastActivity) {
    return { status: 'red', glow: 'danger', dotClass: 'bg-danger', label: 'No activity' };
  }
  const last = parseISO(lastActivity);
  const days = differenceInDays(new Date(), last);
  const label = days === 0 ? 'Today' : formatDistanceToNow(last, { addSuffix: true });
  if (days <= 3) return { status: 'green', glow: 'accent',  dotClass: 'bg-accent',  label };
  if (days <= 7) return { status: 'amber', glow: 'warning', dotClass: 'bg-warning', label };
  return            { status: 'red',   glow: 'danger',  dotClass: 'bg-danger',  label };
}

export function SuperadminView({ clients, onAddCoach, onImpersonate }: SuperadminViewProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const coaches = useMemo(() => clients.filter((c) => c.role === 'admin'), [clients]);

  // Platform-wide stats — single pass over the client tree per metric.
  const stats = useMemo(() => {
    const coachCount = coaches.length;
    const traineeCount = clients.filter((c) => c.role === 'trainee').length;
    const programCount = clients.reduce((sum, c) => sum + c.programs.length, 0);
    let sessionsLogged = 0;
    for (const c of clients) {
      for (const p of c.programs) {
        for (const w of p.weeks) {
          for (const d of w.days) {
            if (d.loggedAt !== undefined) sessionsLogged++;
          }
        }
      }
    }
    return { coachCount, traineeCount, programCount, sessionsLogged };
  }, [clients, coaches.length]);

  const filteredCoaches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return coaches;
    return coaches.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [coaches, searchQuery]);

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex justify-between items-end">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="font-display font-bold uppercase tracking-[0.15em] text-foreground text-4xl">
            Superadmin Control Center
          </h1>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mt-2">
            Platform Overview
          </p>
        </motion.div>
        <Button
          variant="primary"
          onClick={() => setIsCreateOpen(true)}
          data-testid="create-coach-btn"
        >
          + New Coach
        </Button>
      </header>

      {/* ── Platform stats bar ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatTile label="Coaches"         value={stats.coachCount}     />
        <StatTile label="Trainees"        value={stats.traineeCount}   />
        <StatTile label="Programs"        value={stats.programCount}   />
        <StatTile label="Sessions Logged" value={stats.sessionsLogged} />
      </div>

      {/* ── Coaches section ────────────────────────────────────────────── */}
      <div>
        <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60 border-b border-primary/20 pb-2 mb-6">
          All Coaches
        </h2>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search coaches..."
            data-testid="coach-search"
            className="w-full bg-surface border-b border-primary/30 pl-9 pr-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary"
          />
        </div>

        {coaches.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Users className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-display font-bold uppercase tracking-wide text-foreground">
              No Coaches Yet
            </h3>
            <p className="text-muted-foreground font-mono text-xs mt-2 uppercase tracking-widest">
              Create a coach account to get started
            </p>
          </motion.div>
        ) : filteredCoaches.length === 0 ? (
          <p
            className="text-center py-12 font-mono text-xs text-muted-foreground uppercase tracking-widest"
            data-testid="coach-search-empty"
          >
            No coaches match "{searchQuery}"
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {filteredCoaches.map((coach, idx) => (
                <CoachCard
                  key={coach.id}
                  coach={coach}
                  clients={clients}
                  index={idx}
                  onImpersonate={onImpersonate}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <CreateCoachModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onAdd={onAddCoach}
      />
    </div>
  );
}

// ─── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <TechnicalCard>
      <div className="p-5 space-y-1.5">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-display font-bold text-primary tabular-nums leading-none">
          {value}
        </p>
      </div>
    </TechnicalCard>
  );
}

// ─── Coach card ─────────────────────────────────────────────────────────────

function CoachCard({
  coach,
  clients,
  index,
  onImpersonate,
}: {
  coach: Client;
  clients: Client[];
  index: number;
  onImpersonate: (coach: Client) => void;
}) {
  // Per-coach stats — derived once from the broader clients array. The
  // tenant key on a trainee row points at the coach's id (admins satisfy
  // tenantId === id), so a single equality is enough.
  const trainees = clients.filter((c) => c.tenantId === coach.id);
  const traineeCount = trainees.length;
  const programCount = trainees.reduce(
    (n, c) => n + c.programs.filter((p) => p.status !== 'archived').length,
    0,
  );
  const sortedActivity = trainees
    .flatMap((c) => c.programs.flatMap((p) => p.weeks.flatMap((w) => w.days.map((d) => d.loggedAt))))
    .filter((v): v is string => Boolean(v))
    .sort();
  const lastActivity = sortedActivity.length > 0 ? sortedActivity[sortedActivity.length - 1] : null;

  const compliance = getCoachCompliance(lastActivity);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <TechnicalCard glow={compliance.glow}>
        <div className="p-6 space-y-5" data-testid={`coach-card-${coach.id}`}>
          {/* Header: name, email, compliance dot */}
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <h3 className="font-display font-bold uppercase tracking-wide text-foreground text-lg truncate">
                {coach.name}
              </h3>
              <p className="font-mono text-xs text-muted-foreground mt-1 truncate">
                {coach.email}
              </p>
            </div>
            <div className="relative w-2 h-2 mt-2 shrink-0" title={compliance.label}>
              {compliance.status === 'green' && (
                <span
                  className={cn(
                    'absolute inset-0 rounded-full animate-ping opacity-60',
                    compliance.dotClass,
                  )}
                />
              )}
              <span className={cn('absolute inset-0 rounded-full', compliance.dotClass)} />
            </div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-primary/15">
            <CardStat label="Trainees"        value={String(traineeCount)} />
            <CardStat label="Active Programs" value={String(programCount)} />
            <CardStat label="Last Activity"   value={compliance.label}     />
          </div>

          {/* Actions */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onImpersonate(coach)}
            data-testid={`impersonate-${coach.id}`}
            className="w-full inline-flex items-center justify-center gap-2"
          >
            <Eye className="w-3.5 h-3.5" />
            Impersonate
          </Button>
        </div>
      </TechnicalCard>
    </motion.div>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xs text-foreground mt-1 truncate">{value}</p>
    </div>
  );
}

// ─── Create Coach Modal ─────────────────────────────────────────────────────

function CreateCoachModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, email: string, password: string) => Promise<Client>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName(''); setEmail(''); setPassword(''); setConfirm('');
    setErrors([]); setSubmitting(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleAdd = async () => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Name is required.');
    if (!email.trim()) errs.push('Email is required.');
    else if (!isValidEmail(email)) errs.push(INVALID_EMAIL_MESSAGE);
    const strength = checkPasswordStrength(password);
    if (!strength.ok) errs.push(...strength.errors.map((e) => `Password: ${e}`));
    if (password !== confirm) errs.push('Passwords do not match.');
    if (errs.length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      await onAdd(name.trim(), email.trim(), password);
      reset();
      onClose();
    } catch (err) {
      console.error('CreateCoachModal: failed to create coach', err);
      const message = err instanceof Error ? err.message : 'Could not create coach. Please try again.';
      setErrors([message]);
    } finally {
      setSubmitting(false);
    }
  };

  const fields: Array<{ label: string; value: string; set: (v: string) => void; placeholder: string; testId: string; type: string }> = [
    { label: 'Full Name', value: name,     set: setName,     placeholder: 'Coach Name',                        testId: 'new-coach-name',     type: 'text'     },
    { label: 'Email',     value: email,    set: setEmail,    placeholder: 'coach@example.com',                 testId: 'new-coach-email',    type: 'email'    },
    { label: 'Password',  value: password, set: setPassword, placeholder: 'Min 8 chars, 1 letter, 1 number',   testId: 'new-coach-password', type: 'password' },
    { label: 'Confirm',   value: confirm,  set: setConfirm,  placeholder: '••••••••',                          testId: 'new-coach-confirm',  type: 'password' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Coach Account">
      <div className="space-y-5">
        {fields.map(({ label, value, set, placeholder, testId, type }) => (
          <div key={label} className="space-y-1.5">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              {label}
            </label>
            <input
              value={value}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              type={type}
              data-testid={testId}
              className="bg-surface border-b border-primary/30 focus:border-primary p-3 font-mono text-sm text-foreground outline-none w-full"
            />
          </div>
        ))}

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e) => (
              <p key={e} className="text-[10px] font-mono text-danger">{e}</p>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            className="w-full py-3"
            onClick={handleAdd}
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create Coach Account'}
          </Button>
          <Button
            variant="ghost"
            className="w-full py-3"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
