import { useMemo } from 'react';
import { format } from 'date-fns';
import { Modal, TechnicalCard } from '../ui';
import { complianceRate, listLoggedExercises, personalRecord } from '../../lib/analytics';
import type { Client } from '../../types';

interface ProgressReportProps {
  client: Client;
  onClose: () => void;
}

export function ProgressReport({ client, onClose }: ProgressReportProps) {
  const compliance = useMemo(() => complianceRate(client), [client]);
  const loggedExercises = useMemo(() => listLoggedExercises(client), [client]);
  const programsCompleted = useMemo(
    () => client.programs.filter((p) => p.status === 'archived').length,
    [client.programs],
  );

  const personalRecords = useMemo(() => {
    return loggedExercises
      .map((ex) => ({ name: ex.name, pr: personalRecord(client, ex.id) }))
      .filter((row): row is { name: string; pr: NonNullable<ReturnType<typeof personalRecord>> } =>
        row.pr !== null,
      )
      .sort((a, b) => b.pr.e1rm - a.pr.e1rm)
      .slice(0, 10);
  }, [client, loggedExercises]);

  return (
    <Modal isOpen={true} onClose={onClose} title="Progress Report">
      <div className="space-y-8">
        {/* 1 — Header */}
        <div>
          <h3 className="font-display font-bold uppercase text-2xl text-foreground">
            {client.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            Generated {format(new Date(), 'MMM d, yyyy')}
          </p>
          <div className="h-px bg-primary/20 mt-4" />
        </div>

        {/* 2 — Summary tiles */}
        <div className="grid grid-cols-3 gap-3">
          <TechnicalCard glow="none">
            <div className="p-4">
              <p className="font-mono uppercase text-muted-foreground text-[10px] tracking-widest">
                Sessions Logged
              </p>
              <p className="font-display font-bold text-primary text-2xl mt-2">
                {compliance.rate}%
              </p>
            </div>
          </TechnicalCard>
          <TechnicalCard glow="none">
            <div className="p-4">
              <p className="font-mono uppercase text-muted-foreground text-[10px] tracking-widest">
                Exercises Tracked
              </p>
              <p className="font-display font-bold text-primary text-2xl mt-2">
                {loggedExercises.length}
              </p>
            </div>
          </TechnicalCard>
          <TechnicalCard glow="none">
            <div className="p-4">
              <p className="font-mono uppercase text-muted-foreground text-[10px] tracking-widest">
                Programs Completed
              </p>
              <p className="font-display font-bold text-primary text-2xl mt-2">
                {programsCompleted}
              </p>
            </div>
          </TechnicalCard>
        </div>

        {/* 3 — Personal Records table */}
        <div>
          <p className="font-mono uppercase text-muted-foreground text-[10px] tracking-widest mb-3">
            Personal Records
          </p>
          {personalRecords.length === 0 ? (
            <p className="text-muted-foreground font-mono text-xs">No sessions logged yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground border-b border-primary/20">
                  <th className="text-left py-2 pr-2 font-normal">Exercise Name</th>
                  <th className="text-right py-2 px-2 font-normal">Best e1RM</th>
                  <th className="text-right py-2 px-2 font-normal">Load × Reps</th>
                  <th className="text-right py-2 pl-2 font-normal">Date</th>
                </tr>
              </thead>
              <tbody>
                {personalRecords.map((row) => (
                  <tr
                    key={row.name}
                    className="font-mono text-sm border-b border-border/30"
                  >
                    <td className="text-left py-2 pr-2 text-foreground">{row.name}</td>
                    <td className="text-right py-2 px-2 text-primary font-bold">
                      {row.pr.e1rm}
                    </td>
                    <td className="text-right py-2 px-2 text-muted-foreground">
                      {row.pr.load} × {row.pr.reps}
                    </td>
                    <td className="text-right py-2 pl-2 text-muted-foreground">
                      {row.pr.date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 4 — Compliance bar */}
        <div>
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            <span>Session Compliance</span>
            <span className="text-primary">{compliance.rate}%</span>
          </div>
          <div className="h-2 bg-surface border border-border/50 overflow-hidden">
            <div className="h-full bg-primary/60" style={{ width: `${compliance.rate}%` }} />
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            {compliance.logged} of {compliance.total} scheduled sessions completed
          </p>
        </div>

        {/* 5 — Footer */}
        <p className="text-[9px] font-mono text-muted-foreground/50 text-center pt-4 border-t border-border/30">
          Generated by IronTrack · {format(new Date(), 'MMM d, yyyy')}
        </p>
      </div>
    </Modal>
  );
}
