import { useEffect, useState } from 'react';
import { Modal, Button } from './ui';
import { supabase } from '../lib/supabase';
import type { Client } from '../types';

interface AccountSettingsProps {
  user: Client;
  onClose: () => void;
  onUpdated: (name: string) => void;
}

export function AccountSettings({ user, onClose, onUpdated }: AccountSettingsProps) {
  const [nameInput, setNameInput] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === user.name) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from('profiles').update({ name: trimmed }).eq('id', user.id);
      if (error) {
        setToast(`Failed: ${error.message}`);
        return;
      }
      onUpdated(trimmed);
      setToast('Name updated');
    } finally {
      setSavingName(false);
    }
  };

  const validatePassword = (pw: string): string | null => {
    if (pw.length < 8) return 'New password must be at least 8 characters.';
    if (!/[A-Za-z]/.test(pw)) return 'New password must contain a letter.';
    if (!/[0-9]/.test(pw)) return 'New password must contain a number.';
    return null;
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);
    const validationErr = validatePassword(newPw);
    if (validationErr) {
      setPasswordError(validationErr);
      return;
    }
    if (newPw !== confirmPw) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) {
        setPasswordError(error.message);
        return;
      }
      setPasswordSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } finally {
      setSavingPw(false);
    }
  };

  const inputClass =
    'flex-1 bg-surface border-b border-primary/30 p-3 font-mono text-sm text-foreground outline-none focus:border-primary';

  return (
    <Modal isOpen={true} onClose={onClose} title="Account Settings">
      <div className="space-y-6">
        {/* Section 1 — Display Name */}
        <div className="space-y-2">
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Display Name
          </label>
          <div className="flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              data-testid="settings-name-input"
              className={inputClass}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={nameInput.trim() === user.name || !nameInput.trim() || savingName}
              onClick={() => void handleSaveName()}
              data-testid="settings-name-save"
            >
              {savingName ? 'Saving...' : 'Save'}
            </Button>
          </div>
          {toast && (
            <p className="text-[10px] font-mono text-primary" data-testid="settings-toast">
              {toast}
            </p>
          )}
        </div>

        {/* Section 2 — Change Password */}
        <div className="space-y-3 border-t border-primary/20 pt-6">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Change Password
          </p>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current Password"
            autoComplete="current-password"
            data-testid="settings-pw-current"
            className={`${inputClass} w-full`}
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New Password"
            autoComplete="new-password"
            data-testid="settings-pw-new"
            className={`${inputClass} w-full`}
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm New Password"
            autoComplete="new-password"
            data-testid="settings-pw-confirm"
            className={`${inputClass} w-full`}
          />
          {passwordError && (
            <p className="text-[10px] font-mono text-danger" data-testid="settings-pw-error">
              {passwordError}
            </p>
          )}
          {passwordSuccess && (
            <p className="text-[10px] font-mono text-primary" data-testid="settings-pw-success">
              Password updated
            </p>
          )}
          <Button
            variant="primary"
            className="w-full py-3"
            disabled={!currentPw || !newPw || !confirmPw || savingPw}
            onClick={() => void handleChangePassword()}
            data-testid="settings-pw-submit"
          >
            {savingPw ? 'Updating...' : 'Update Password'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
