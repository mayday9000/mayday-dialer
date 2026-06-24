import type { CampaignBrief } from "@/lib/db/schema";

/** Compact natural-language classifier rules derived from a campaign brief,
 *  passed verbatim to the Haiku lead classifier. Shared by the campaign launch
 *  wizard and the per-city "Add city" flow so both scrape with the same rules. */
export function buildCustomRules(b: CampaignBrief): string {
  const lines: string[] = [];
  if (b.icp) lines.push(`Target ICP: ${b.icp}`);
  if (b.qualifiers?.length) lines.push(`Approve if: ${b.qualifiers.join("; ")}`);
  if (b.disqualifiers?.length) lines.push(`Reject if: ${b.disqualifiers.join("; ")}`);
  return lines.join("\n");
}
