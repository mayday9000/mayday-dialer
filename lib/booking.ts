/**
 * Booking invite templates. Campaign-level defaults (title/description) support
 * simple {company} {contact} {first} {city} tokens, filled with the lead's data
 * so the Book dialog is prefilled and you can book with just a time + email.
 */
export const DEFAULT_MEETING_TITLE = "Intro call — {company}";
export const DEFAULT_MEETING_DESCRIPTION =
  "Quick intro call with {contact} at {company} to see if we can help cut their back-office busywork.";
export const DEFAULT_MEETING_DURATION = 30;

export type BookingLead = {
  companyName: string | null;
  contactName: string | null;
  city: string | null;
};

export function fillBookingTemplate(tpl: string, lead: BookingLead): string {
  const company = lead.companyName?.trim() || "your team";
  const contact = lead.contactName?.trim() || "you";
  const first = contact.split(/\s+/)[0] || contact;
  const city = (lead.city ?? "").split(",")[0]?.trim() || "";
  return tpl
    .replace(/\{company\}/gi, company)
    .replace(/\{contact\}/gi, contact)
    .replace(/\{first\}/gi, first)
    .replace(/\{city\}/gi, city)
    .replace(/\s+/g, " ")
    .trim();
}
