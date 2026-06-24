/**
 * Fills script placeholders with the current lead's data so the caller sees a
 * script tailored to the business they're calling — no AI, no cost, instant.
 *
 * Only a whitelist of data tokens is replaced; instructional brackets like
 * [IF YES], [Shut up and listen], [DISARM ...] are left untouched.
 *
 * Replaced (case-insensitive): [first name], [DM name], [name], [contact],
 * [company], [city], [number]  (and the {curly} variants the editor seeds).
 */
export function personalizeScript(
  md: string,
  lead: {
    contactName?: string | null;
    companyName?: string | null;
    customFields?: Record<string, string> | null;
  },
  callerId?: string | null,
): string {
  // Some leads carry two names ("Scott Wilkinson / Michelle Messick") — use the first.
  const full = (lead.contactName || "").split("/")[0].trim();
  const first = full.split(/\s+/)[0] || "there";
  const company = (lead.companyName || "").trim() || "your firm";
  const dm = full || "whoever runs operations";
  const city = lead.customFields?.City?.split(",")[0]?.trim() || "";
  const number = callerId || "[your number]";

  const subs: [RegExp, string][] = [
    [/\[first name\]/gi, first],
    [/\{first name\}/gi, first],
    [/\[dm name\]/gi, dm],
    [/\[contact\]/gi, dm],
    [/\{contact\}/gi, dm],
    [/\[name\]/gi, dm], // [Name]/[name]; won't match inside "[DM name]"
    [/\[company\]/gi, company],
    [/\{company\}/gi, company],
    [/\[number\]/gi, number],
    [/\[city\]/gi, city],
  ];

  let out = md;
  for (const [re, val] of subs) out = out.replace(re, val);
  return out;
}
