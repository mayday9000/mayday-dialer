/**
 * Phone normalization for dedup. CSV exports are messy:
 *   "(415) 555-0142", "415.555.0142", "+1 415-555-0142", "4155550142",
 *   "1-415-555-0142 ext 12"
 * all refer to the same line. We reduce to a canonical key for comparison
 * while preserving the original string for display/dialing.
 *
 * Strategy (US-centric, since this is a US cold-calling tool, but tolerant):
 *  - strip everything but digits and a leading +
 *  - drop a US country code (leading 1 on an 11-digit number)
 *  - the normalized key is the bare significant digits
 *  - E.164 best-effort for actually placing the call
 */

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Drop extensions ("x123", "ext. 5", etc.) before stripping.
  const withoutExt = raw.split(/\b(?:ext|x|extension)\.?\b/i)[0];

  let digits = withoutExt.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Strip a US country code: 11 digits starting with 1 -> 10 digits.
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  // Need at least 10 digits to be a plausible North American number.
  // Shorter strings are kept as-is so we don't silently merge junk, but
  // they still dedup against identical junk.
  return digits;
}

/**
 * Best-effort E.164 for dialing via the telephony provider.
 * Assumes US (+1) when given 10 digits. Returns null if we can't form
 * something dialable.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already E.164-ish.
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;

  const normalized = normalizePhone(raw);
  if (!normalized) return null;

  if (normalized.length === 10) return `+1${normalized}`;
  if (normalized.length >= 8 && normalized.length <= 15) return `+${normalized}`;
  return null;
}

/** Pretty US formatting for display; falls back to the original. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const n = normalizePhone(raw);
  if (n && n.length === 10) {
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return raw;
}
