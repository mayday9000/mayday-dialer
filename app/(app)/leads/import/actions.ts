"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { leads, leadEvents, campaignLeads, LEAD_STATUSES, type LeadStatus } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { normalizePhone } from "@/lib/phone";
import type { LeadFieldKey } from "@/lib/csv";

export type ImportRow = Record<string, string>;

export type ImportResult = {
  ok: boolean;
  imported: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  missingPhone: number;
  total: number;
  error?: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function importLeads(
  rows: ImportRow[],
  mapping: Record<string, LeadFieldKey | null>,
  source: string,
  campaignId?: string,
): Promise<ImportResult> {
  const user = await requireUser();
  const total = rows.length;

  if (!rows.length) {
    return { ok: false, imported: 0, duplicatesInFile: 0, duplicatesInDb: 0, missingPhone: 0, total: 0, error: "No rows to import." };
  }

  // Invert mapping: fieldKey -> header
  const fieldToHeader: Partial<Record<LeadFieldKey, string>> = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (key) fieldToHeader[key] = header;
  }
  if (!fieldToHeader.phone) {
    return { ok: false, imported: 0, duplicatesInFile: 0, duplicatesInDb: 0, missingPhone: 0, total, error: "Map a Phone column before importing." };
  }
  const mappedHeaders = new Set(Object.keys(mapping).filter((h) => mapping[h]));

  type Draft = typeof leads.$inferInsert;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  let missingPhone = 0;

  for (const row of rows) {
    const get = (key: LeadFieldKey) => {
      const h = fieldToHeader[key];
      return h ? (row[h] ?? "").trim() : "";
    };

    const rawPhone = get("phone");
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      missingPhone++;
      continue;
    }
    if (seen.has(normalized)) {
      duplicatesInFile++;
      continue;
    }
    seen.add(normalized);

    const statusRaw = get("status").toLowerCase().replace(/\s+/g, "_");
    const status: LeadStatus = (LEAD_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as LeadStatus)
      : "new";

    // Anything not mapped to a known field is preserved in customFields.
    const customFields: Record<string, string> = {};
    for (const [header, value] of Object.entries(row)) {
      if (!mappedHeaders.has(header) && value != null && String(value).trim() !== "") {
        customFields[header] = String(value).trim();
      }
    }

    drafts.push({
      companyName: get("companyName") || null,
      contactName: get("contactName") || null,
      title: get("title") || null,
      phone: rawPhone || null,
      phoneNormalized: normalized,
      email: get("email") || null,
      website: get("website") || null,
      status,
      customFields,
      source,
      createdBy: user.id,
    });
  }

  if (!drafts.length) {
    return { ok: true, imported: 0, duplicatesInFile, duplicatesInDb: 0, missingPhone, total };
  }

  // Dedup against the DB: which normalized phones already exist?
  const allNormalized = drafts.map((d) => d.phoneNormalized!).filter(Boolean);
  const existing = new Set<string>();
  for (const part of chunk(allNormalized, 500)) {
    const found = await db
      .select({ p: leads.phoneNormalized })
      .from(leads)
      .where(inArray(leads.phoneNormalized, part));
    for (const r of found) if (r.p) existing.add(r.p);
  }

  const toInsert = drafts.filter((d) => !existing.has(d.phoneNormalized!));
  const duplicatesInDb = drafts.length - toInsert.length;

  let imported = 0;
  for (const part of chunk(toInsert, 200)) {
    // onConflictDoNothing guards against a race on the unique phone index.
    const inserted = await db
      .insert(leads)
      .values(part)
      .onConflictDoNothing({ target: leads.phoneNormalized })
      .returning({ id: leads.id });
    imported += inserted.length;

    if (inserted.length) {
      await db.insert(leadEvents).values(
        inserted.map((r) => ({
          leadId: r.id,
          userId: user.id,
          type: "import" as const,
          body: `Imported from ${source}`,
        })),
      );
    }
  }

  // If importing into a campaign, link every lead from the file (new + ones
  // that already existed) to the campaign.
  if (campaignId && allNormalized.length) {
    const ids = new Set<string>();
    for (const part of chunk(allNormalized, 500)) {
      const found = await db
        .select({ id: leads.id })
        .from(leads)
        .where(inArray(leads.phoneNormalized, part));
      for (const r of found) ids.add(r.id);
    }
    if (ids.size) {
      await db
        .insert(campaignLeads)
        .values([...ids].map((leadId) => ({ campaignId, leadId })))
        .onConflictDoNothing();
    }
    revalidatePath(`/campaigns/${campaignId}/leads`);
    revalidatePath(`/campaigns/${campaignId}`);
  }

  revalidatePath("/leads");
  return { ok: true, imported, duplicatesInFile, duplicatesInDb, missingPhone, total };
}
