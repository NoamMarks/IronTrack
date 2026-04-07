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
}

export interface Client {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: 'coach' | 'trainee';
  activeProgramId?: string;
  programs: Program[];
}

export type AppView = 'landing' | 'coach' | 'trainee' | 'admin';
