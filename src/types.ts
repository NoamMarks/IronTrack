export interface ProgramColumn {
  id: string;
  label: string;
  type: 'plan' | 'actual';
}

export interface ExercisePlan {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets?: number;
  reps?: string;
  expectedRpe?: string;
  weightRange?: string;
  actualLoad?: string;
  actualRpe?: string;
  notes?: string;
  videoUrl?: string;
  values: Record<string, string>;
}

export interface WorkoutDay {
  id: string;
  dayNumber: number;
  name: string;
  exercises: ExercisePlan[];
  /** ISO timestamp of the last save — used by analytics to order sessions chronologically */
  loggedAt?: string;
  /** Post-workout difficulty rating (1 = trivial, 5 = brutal). Set when the
   *  trainee submits the reflection modal after Finish Workout. */
  difficulty?: number;
  /** Free-text note captured alongside the difficulty rating. */
  reflectionNote?: string;
  /** ISO timestamp the reflection was submitted. */
  reflectionAt?: string;
  /** Short text response left by the coach after reading the trainee's
   *  reflection. Displayed read-only in the trainee's Workout History modal. */
  coachNote?: string;
}

export interface WorkoutWeek {
  id: string;
  weekNumber: number;
  days: WorkoutDay[];
}

export type ProgramStatus = 'active' | 'archived';

export interface Program {
  id: string;
  name: string;
  weeks: WorkoutWeek[];
  columns: ProgramColumn[];
  /** Defaults to 'active' for backwards compatibility with pre-Sprint-2 data */
  status: ProgramStatus;
  /** ISO timestamp set when the program is archived */
  archivedAt?: string;
  /** ISO timestamp set when the program is created */
  createdAt?: string;
  /** Tenant isolation — programs belong to the coach who created them */
  tenantId?: string;
  /** Coach-authored block notes — goal/methodology/focus points the trainee
   *  reads before logging. Null/undefined when unset. */
  coachNotes?: string;
}

export type UserRole = 'superadmin' | 'admin' | 'trainee';

export interface Client {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  /** Tenant isolation key — 'global' for superadmin, coach-id for admins, inherited for trainees */
  tenantId?: string;
  activeProgramId?: string;
  programs: Program[];
}

/** Invite code created by a coach to onboard new trainees */
export interface InviteCode {
  id: string;
  code: string;
  tenantId: string;
  coachId: string;
  /** Display name shown to the invitee in the welcome banner */
  coachName?: string;
  createdAt: string;
  /** Maximum number of accepted signups; undefined means unlimited */
  maxUses?: number;
  /** How many trainees have signed up using this code so far */
  useCount?: number;
}

export type AppView = 'landing' | 'signup' | 'forgot' | 'superadmin' | 'coach' | 'trainee' | 'admin';