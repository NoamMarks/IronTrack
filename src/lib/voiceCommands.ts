/**
 * Parse a voice transcript into seconds for a rest timer.
 *
 * Supported patterns:
 *   "timer three minutes"
 *   "rest ninety seconds"
 *   "rest 2 minutes 30 seconds"
 *   "timer 90 seconds"
 *   "3 minutes"
 *   "90 seconds"
 */

const WORD_TO_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

function toNumber(s: string): number | null {
  const n = Number(s);
  if (!isNaN(n)) return n;
  return WORD_TO_NUM[s.toLowerCase()] ?? null;
}

export interface ParsedTimer {
  seconds: number;
}

export function parseTimerCommand(transcript: string): ParsedTimer | null {
  const raw = transcript.toLowerCase().trim();

  // strip leading trigger words
  const stripped = raw.replace(/^(timer|rest|set timer|start)\s*/i, '');

  if (!stripped) return null;

  // Try: "<N> minutes [and] <M> seconds"
  const compoundRe = /(\w+)\s+minutes?\s*(?:and\s*)?(\w+)\s+seconds?/;
  const compoundMatch = stripped.match(compoundRe);
  if (compoundMatch) {
    const mins = toNumber(compoundMatch[1]);
    const secs = toNumber(compoundMatch[2]);
    if (mins !== null && secs !== null) {
      return { seconds: mins * 60 + secs };
    }
  }

  // Try: "<N> minutes"
  const minRe = /(\w+)\s+minutes?/;
  const minMatch = stripped.match(minRe);
  if (minMatch) {
    const mins = toNumber(minMatch[1]);
    if (mins !== null && mins > 0) return { seconds: mins * 60 };
  }

  // Try: "<N> seconds"
  const secRe = /(\w+)\s+seconds?/;
  const secMatch = stripped.match(secRe);
  if (secMatch) {
    const secs = toNumber(secMatch[1]);
    if (secs !== null && secs > 0) return { seconds: secs };
  }

  return null;
}
