import { normalizePhone } from "@/lib/phone";

/**
 * TCPA calling-hours support. Telemarketing calls are restricted to
 * 8am–9pm in the CALLED PARTY's local time. We estimate that timezone from
 * the lead's state (most reliable for B2B office lines) and fall back to the
 * phone's area code. Multi-timezone states use the predominant zone, so this
 * is an advisory guardrail, not a legal guarantee.
 */

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const MST = "America/Phoenix"; // no DST
const PT = "America/Los_Angeles";
const AKT = "America/Anchorage";
const HT = "Pacific/Honolulu";

// State (predominant timezone). Split states noted approximate.
const STATE_TZ: Record<string, string> = {
  AL: CT, AK: AKT, AZ: MST, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET,
  FL: ET, GA: ET, HI: HT, ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET,
  LA: CT, ME: ET, MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT,
  NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET,
  OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT,
  VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
};

// Curated common US area codes -> timezone (fallback when no state).
const AREA_CODE_TZ: Record<string, string> = {};
const add = (tz: string, codes: string[]) => codes.forEach((c) => (AREA_CODE_TZ[c] = tz));
add(ET, ["202","203","212","215","216","267","301","302","305","321","332","336","347","386","404","407","410","412","434","443","470","475","561","570","571","607","610","617","646","678","703","704","717","718","724","727","732","743","754","757","770","772","786","804","813","814","828","843","848","856","857","860","862","878","904","908","912","914","917","919","929","954","959","973","980","984"]);
add(CT, ["205","210","214","217","224","225","251","256","262","281","309","312","314","316","318","319","337","361","402","405","409","414","417","430","432","469","479","501","504","512","515","563","573","580","601","608","612","615","618","630","636","651","660","662","682","708","713","715","731","737","763","769","773","779","785","806","815","816","817","830","832","847","870","901","903","913","915","918","920","931","936","940","952","956","972","979"]);
add(MT, ["303","307","385","406","435","505","575","719","720","801","970"]);
add(MST, ["480","520","602","623","928"]);
add(PT, ["206","209","213","253","279","310","323","360","408","415","424","425","442","458","503","510","530","541","559","562","619","626","650","657","661","669","702","707","714","725","747","760","775","805","818","831","858","909","916","925","949","951","971"]);
add(AKT, ["907"]);
add(HT, ["808"]);

function stateFromCity(city: string | undefined | null): string | null {
  if (!city) return null;
  const m = city.toUpperCase().match(/\b([A-Z]{2})\b(?:\s+\d{5})?/g);
  if (!m) return null;
  for (const token of m) {
    const abbr = token.trim().slice(0, 2);
    if (STATE_TZ[abbr]) return abbr;
  }
  return null;
}

/** Best-effort IANA timezone for a lead. */
export function leadTimezone(lead: {
  phone?: string | null;
  customFields?: Record<string, string> | null;
}): string | null {
  const state = stateFromCity(lead.customFields?.City);
  if (state) return STATE_TZ[state];
  const norm = normalizePhone(lead.phone);
  if (norm && norm.length === 10) {
    const area = norm.slice(0, 3);
    if (AREA_CODE_TZ[area]) return AREA_CODE_TZ[area];
  }
  return null;
}

const TZ_ABBR: Record<string, string> = {
  [ET]: "ET", [CT]: "CT", [MT]: "MT", [MST]: "MST", [PT]: "PT", [AKT]: "AKT", [HT]: "HT",
};

export type CallTimeInfo = {
  tz: string | null;
  abbr: string | null;
  localTime: string | null; // e.g. "7:42 PM"
  withinHours: boolean; // true if unknown (don't block on missing data) or 8am–9pm
  known: boolean;
};

/** Computes the lead's current local time + whether it's within 8am–9pm. */
export function callTimeInfo(
  lead: { phone?: string | null; customFields?: Record<string, string> | null },
  now: Date = new Date(),
): CallTimeInfo {
  const tz = leadTimezone(lead);
  if (!tz) return { tz: null, abbr: null, localTime: null, withinHours: true, known: false };

  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  return {
    tz,
    abbr: TZ_ABBR[tz] ?? null,
    localTime,
    withinHours: hour >= 8 && hour < 21,
    known: true,
  };
}

// NOTE: We deliberately do NOT estimate a business's open/closed state from
// "typical" hours — that produced false "closed"/"open" claims. Office hours
// are treated as Unknown until we have REAL data (Google Places or manually
// entered). The TCPA calling-window check above (callTimeInfo) is a separate,
// legal constraint and is kept.
