/**
 * Invite Code management — persisted in localStorage.
 * Each code is permanently linked to a Coach's tenantId and carries metadata
 * (coachName, optional maxUses) used to render the magic-link signup banner.
 */

import type { InviteCode } from '../types';

const STORAGE_KEY = 'irontrack_invite_codes';

/**
 * Canonicalise a code string so accidental whitespace, lowercase entry, or
 * copy-paste artefacts never cause a lookup miss. Used at every boundary —
 * storage, lookup, consume, and the URL-param read in SignupPage.
 */
export function normalizeInviteCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Migrate legacy invite records (pre-Sprint-5) to include useCount and a
 *  re-canonicalised code (in case anything pre-normalisation was persisted). */
function normalizeRecord(code: InviteCode): InviteCode {
  return {
    useCount: 0,
    ...code,
    code: normalizeInviteCode(code.code),
  };
}

function loadCodes(): InviteCode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as InviteCode[]).map(normalizeRecord);
  } catch {
    return [];
  }
}

function saveCodes(codes: InviteCode[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
}

/** Generate a short, unique, human-readable invite code. */
function makeCode(): string {
  // 8 alphanumeric chars, uppercase for readability. normalizeInviteCode is a
  // belt-and-braces guarantee so makeCode and lookups always agree.
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(5)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8);
  return normalizeInviteCode(raw);
}

/** Create a new invite code for a coach. */
export function createInviteCode(
  coachId: string,
  tenantId: string,
  coachName?: string,
  maxUses?: number,
): InviteCode {
  // Defensive: a code without coachId or tenantId is unusable downstream
  // (trainee creation will throw "requires a tenantId"). Fail loudly here so
  // the bug is caught at generation time, not at signup.
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

  const codes = loadCodes();
  const invite: InviteCode = {
    id: Math.random().toString(36).substring(2, 9),
    code: makeCode(),
    tenantId: tenantId.trim(),
    coachId: coachId.trim(),
    coachName,
    createdAt: new Date().toISOString(),
    maxUses,
    useCount: 0,
  };
  saveCodes([...codes, invite]);
  return invite;
}

/** Get all invite codes for a specific coach. */
export function getInviteCodesForCoach(coachId: string): InviteCode[] {
  return loadCodes().filter((c) => c.coachId === coachId);
}

/**
 * Predicate: a code with maxUses == null (or undefined, or any non-positive
 * value) is unlimited — never expires from useCount alone. We compare loosely
 * against null so legacy localStorage payloads that explicitly stored
 * `"maxUses": null` are treated identically to fresh codes with the field
 * absent.
 */
function isUnlimited(invite: InviteCode): boolean {
  return invite.maxUses == null || invite.maxUses <= 0;
}

/**
 * Look up an invite code by code string.
 * Returns null if the code is unknown OR if it has reached its maxUses cap.
 */
export function lookupInviteCode(code: string): InviteCode | null {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;
  const found = loadCodes().find((c) => c.code === normalized);
  if (!found) return null;
  // Defensive: an invite without a tenantId can't be used to create a trainee
  // (addClient will throw). Treat it as corrupt rather than letting the silent
  // failure cascade into the signup flow.
  if (!found.tenantId || !found.tenantId.trim()) {
    console.error('[IronTrack invite] code lookup found a record with no tenantId — refusing', found);
    return null;
  }
  if (!isUnlimited(found) && (found.useCount ?? 0) >= found.maxUses!) {
    return null;
  }
  return found;
}

/** Increment the use counter for a code after a successful signup. */
export function consumeInviteCode(code: string): void {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return;
  const codes = loadCodes();
  const idx = codes.findIndex((c) => c.code === normalized);
  if (idx === -1) return;
  codes[idx] = { ...codes[idx], useCount: (codes[idx].useCount ?? 0) + 1 };
  saveCodes(codes);
}

/**
 * Build the shareable signup URL for a given invite code.
 *
 * Prefers the build-time `VITE_PUBLIC_URL` env var so locally generated links
 * point at the production domain instead of `localhost:5173`. Falls back to
 * `window.location.origin` when the env var is unset (e.g. during tests or
 * when the deployer hasn't configured one).
 */
export function buildInviteLink(code: string): string {
  const envUrl = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim();
  const baseUrl = envUrl && envUrl.length > 0
    ? envUrl.replace(/\/+$/, '') // strip trailing slashes for clean concatenation
    : window.location.origin;
  return `${baseUrl}/signup?invite=${encodeURIComponent(code)}`;
}

/** Delete an invite code. */
export function deleteInviteCode(codeId: string): void {
  saveCodes(loadCodes().filter((c) => c.id !== codeId));
}
