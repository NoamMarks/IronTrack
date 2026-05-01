/**
 * Invite Code management — Phase 3 (Supabase backend).
 *
 * Replaces the localStorage `irontrack_invite_codes` store with the
 * `public.invite_codes` table. Lookups are anonymous-readable per RLS so the
 * unauthenticated signup form can resolve a code before sign-in.
 *
 * Functions are async; UI components that previously called these as
 * synchronous helpers must `await` them now.
 */

import { supabase } from './supabase';
import type { InviteCode } from '../types';

// ─── Code normalization (unchanged from localStorage era) ───────────────────

export function normalizeInviteCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

function makeCode(): string {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(5)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8);
  return normalizeInviteCode(raw);
}

// ─── Row → domain mapping ───────────────────────────────────────────────────

interface InviteRow {
  id: string;
  code: string;
  coach_id: string;
  tenant_id: string;
  coach_name: string | null;
  max_uses: number | null;
  use_count: number | null;
  created_at: string;
}

function rowToInvite(row: InviteRow): InviteCode {
  return {
    id: row.id,
    code: row.code,
    coachId: row.coach_id,
    tenantId: row.tenant_id,
    coachName: row.coach_name ?? undefined,
    maxUses: row.max_uses ?? undefined,
    useCount: row.use_count ?? 0,
    createdAt: row.created_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createInviteCode(
  coachId: string,
  tenantId: string,
  coachName?: string,
  maxUses?: number,
): Promise<InviteCode> {
  if (!coachId || !coachId.trim()) {
    const err = new Error(`createInviteCode: coachId must be a non-empty string (got "${coachId}")`);
    console.error('[IronTrack invite]', err);
    throw err;
  }
  if (!tenantId || !tenantId.trim()) {
    const err = new Error(`createInviteCode: tenantId must be a non-empty string (got "${tenantId}")`);
    console.error('[IronTrack invite]', err);
    throw err;
  }
  const payload = {
    code: makeCode(),
    coach_id: coachId.trim(),
    tenant_id: tenantId.trim(),
    coach_name: coachName ?? null,
    max_uses: maxUses ?? null,
    use_count: 0,
  };
  const { data, error } = await supabase
    .from('invite_codes')
    .insert(payload)
    .select()
    .single<InviteRow>();
  if (error || !data) {
    console.error('[IronTrack invite] createInviteCode failed', error);
    throw error ?? new Error('createInviteCode: no data returned');
  }
  return rowToInvite(data);
}

export async function getInviteCodesForCoach(coachId: string): Promise<InviteCode[]> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('coach_id', coachId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[IronTrack invite] getInviteCodesForCoach failed', error);
    return [];
  }
  return (data ?? []).map((row) => rowToInvite(row as InviteRow));
}

export async function lookupInviteCode(code: string): Promise<InviteCode | null> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', normalized)
    .maybeSingle<InviteRow>();
  if (error) {
    console.error('[IronTrack invite] lookupInviteCode failed', error);
    return null;
  }
  if (!data) return null;
  if (!data.tenant_id || !data.tenant_id.trim()) {
    console.error('[IronTrack invite] code has no tenant_id — refusing', data);
    return null;
  }
  // Treat null/undefined/zero as unlimited (matches Sprint 5 semantics).
  if (data.max_uses != null && data.max_uses > 0 && (data.use_count ?? 0) >= data.max_uses) {
    return null;
  }
  return rowToInvite(data);
}

export async function consumeInviteCode(code: string): Promise<void> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return;
  // Atomically increment use_count via a SQL expression. supabase-js doesn't
  // expose `raw('use_count + 1')` directly, so we read+write — acceptable
  // because invites have low write contention (one signup per code).
  const { data: existing, error: fetchErr } = await supabase
    .from('invite_codes')
    .select('id, use_count')
    .eq('code', normalized)
    .maybeSingle<{ id: string; use_count: number | null }>();
  if (fetchErr || !existing) return;
  await supabase
    .from('invite_codes')
    .update({ use_count: (existing.use_count ?? 0) + 1 })
    .eq('id', existing.id);
}

export async function deleteInviteCode(codeId: string): Promise<void> {
  const { error } = await supabase.from('invite_codes').delete().eq('id', codeId);
  if (error) console.error('[IronTrack invite] deleteInviteCode failed', error);
}

// ─── Magic-link URL builder (unchanged) ─────────────────────────────────────

export function buildInviteLink(code: string): string {
  const envUrl = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim();
  const baseUrl = envUrl && envUrl.length > 0
    ? envUrl.replace(/\/+$/, '')
    : window.location.origin;
  return `${baseUrl}/signup?invite=${encodeURIComponent(code)}`;
}
