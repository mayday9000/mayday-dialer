// Field definitions for CSV import + a header auto-mapper.

export const LEAD_FIELDS = [
  { key: "companyName", label: "Company" },
  { key: "contactName", label: "Contact name" },
  { key: "title", label: "Title" },
  { key: "phone", label: "Phone", required: true },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "status", label: "Status" },
] as const;

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];

// Common header aliases -> our field key. Lowercased, non-alnum stripped.
const ALIASES: Record<string, LeadFieldKey> = {
  company: "companyName",
  companyname: "companyName",
  business: "companyName",
  organization: "companyName",
  account: "companyName",

  name: "contactName",
  contact: "contactName",
  contactname: "contactName",
  fullname: "contactName",
  decisionmaker: "contactName",
  owner: "contactName",

  title: "title",
  jobtitle: "title",
  position: "title",
  role: "title",

  phone: "phone",
  phonenumber: "phone",
  phone1: "phone",
  primaryphone: "phone",
  mobile: "phone",
  cell: "phone",
  tel: "phone",
  telephone: "phone",
  number: "phone",

  email: "email",
  emailaddress: "email",
  email1: "email",
  primaryemail: "email",

  website: "website",
  url: "website",
  web: "website",
  site: "website",
  domain: "website",

  status: "status",
  stage: "status",
};

function canon(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort mapping from CSV headers -> field keys. Unmatched -> null. */
export function guessMapping(headers: string[]): Record<string, LeadFieldKey | null> {
  const used = new Set<LeadFieldKey>();
  const mapping: Record<string, LeadFieldKey | null> = {};
  for (const h of headers) {
    const guess = ALIASES[canon(h)] ?? null;
    if (guess && !used.has(guess)) {
      mapping[h] = guess;
      used.add(guess);
    } else {
      mapping[h] = null;
    }
  }
  return mapping;
}
