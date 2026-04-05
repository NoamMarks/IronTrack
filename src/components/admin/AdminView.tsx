import { useState } from 'react';
import { ArrowLeft, Trash2, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';
import { ProgramEditor } from './ProgramEditor';
import { cn } from '../../lib/utils';
import { createDefaultProgram } from '../../constants/mockData';
import { checkPasswordStrength } from '../../lib/crypto';
import type { Client, Program } from '../../types';

interface AdminViewProps {
  clients: Client[];
  onUpdateClients: (clients: Client[]) => void;
  onResetPassword: (clientId: string, newPassword: string) => Promise<void>;
  onBack: () => void;
}

export function AdminView({ clients, onUpdateClients, onResetPassword, onBack }: AdminViewProps) {
  const trainees = clients.filter((c) => c.role === 'trainee');

  const [selectedClient, setSelectedClient] = useState<Client | null>(trainees[0] ?? null);
  const [editingProgram, setEditingProgram] = useState<Program | null>(
    trainees[0]?.programs[0] ?? null
  );

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    setEditingProgram(client.programs[0] ?? null);
  };

  const handleCreateProgram = () => {
    if (!selectedClient) return;
    const newProgram = createDefaultProgram();
    const updatedClients = clients.map((c) =>
      c.id === selectedClient.id
        ? { ...c, programs: [...c.programs, newProgram], activeProgramId: newProgram.id }
        : c
    );
    setEditingProgram(newProgram);
    onUpdateClients(updatedClients);
  };

  const handleResetPassword = async (clientId: string, clientName: string) => {
    const newPassword = window.prompt(
      `Enter new password for ${clientName}:\n(min 8 chars, 1 letter, 1 number)`
    );
    if (!newPassword) return;
    const { ok, errors } = checkPasswordStrength(newPassword);
    if (!ok) { window.alert(`Password too weak:\n${errors.join('\n')}`); return; }
    await onResetPassword(clientId, newPassword);
    window.alert(`Password reset for ${clientName}.\nNew password: ${newPassword}`);
  };

  const handleDeleteClient = (clientId: string) => {
    if (!window.confirm('Remove this client and all their data? This cannot be undone.')) return;
    const remaining = clients.filter((c) => c.id !== clientId);
    onUpdateClients(remaining);
    if (selectedClient?.id === clientId) {
      const nextTrainee = remaining.filter((c) => c.role === 'trainee')[0] ?? null;
      setSelectedClient(nextTrainee);
      setEditingProgram(nextTrainee?.programs[0] ?? null);
    }
  };

  const handleProgramChange = (updated: Program) => {
    if (!selectedClient) return;
    const updatedClients = clients.map((c) =>
      c.id === selectedClient.id
        ? { ...c, programs: c.programs.map((p) => (p.id === updated.id ? updated : p)) }
        : c
    );
    setEditingProgram(updated);
    onUpdateClients(updatedClients);
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div className="flex items-center space-x-8">
          <motion.button
            whileHover={{ x: -4 }}
            onClick={onBack}
            className="p-3 hover:bg-muted transition-colors rounded-sm"
          >
            <ArrowLeft className="w-8 h-8 text-foreground" />
          </motion.button>
          <div>
            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
              Admin Panel
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
              Program &amp; Client Architect
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[300px_1fr] gap-12">
        {/* Client list */}
        <div className="space-y-6">
          <h3 className="text-xs font-mono uppercase text-muted-foreground tracking-widest border-b border-border pb-2">
            Select Client
          </h3>
          <div className="space-y-3">
            {trainees.map((c) => (
              <div key={c.id} className="relative group">
                <button
                  onClick={() => handleSelectClient(c)}
                  className={cn(
                    'w-full text-left p-6 border transition-all rounded-sm pr-12',
                    selectedClient?.id === c.id
                      ? 'bg-foreground text-background border-foreground shadow-lg scale-[1.02]'
                      : 'border-border hover:border-muted-foreground bg-card'
                  )}
                >
                  <p className="font-bold text-lg tracking-tight">{c.name}</p>
                  <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest mt-1">
                    {c.email}
                  </p>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleResetPassword(c.id, c.name); }}
                  className="absolute top-3 right-11 p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-blue-400 transition-all"
                  title="Reset password"
                >
                  <KeyRound className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteClient(c.id); }}
                  className="absolute top-3 right-3 p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                  title="Remove client"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Program editor */}
        <div className="space-y-10">
          {editingProgram ? (
            <ProgramEditor program={editingProgram} onChange={handleProgramChange} />
          ) : (
            <div className="flex flex-col items-center justify-center py-32 space-y-6">
              <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                No program assigned
              </p>
              <h2 className="text-4xl font-bold italic font-serif text-foreground tracking-tight">
                Ready to Build?
              </h2>
              <button
                onClick={handleCreateProgram}
                className="bg-foreground text-background px-8 py-4 text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg"
              >
                + Create New Block
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Version footer */}
      <div className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pt-4">
        IronTrack v{__APP_VERSION__}
      </div>
    </div>
  );
}
