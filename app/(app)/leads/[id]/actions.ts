"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  leads,
  leadEvents,
  campaignLeads,
  campaigns,
  callTranscripts,
  LEAD_STATUSES,
  type LeadStatus,
  type LeadEnrichment,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth-server";
import { normalizePhone } from "@/lib/phone";
import { parseHoursText } from "@/lib/hours";
import { leadStatusLabel } from "@/components/lead-status-badge";
import { generateKeyNotes } from "@/lib/ai/key-notes";
import { isAnthropicConfigured } from "@/lib/ai/client";
import { placesLookup } from "@/lib/harvest/sources/places";
import { isPlacesConfigured } from "@/lib/harvest/config";

export type Result = { ok: true } | { ok: false; error: string };
export type KeyNotesResult = { ok: true; notes: string[] } | { ok: false; error: string };

export type LeadPatch = {
  companyName?: string;
  contactName?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  status?: LeadStatus;
  callbackAt?: string | null; // ISO string or null to clear
};

export async function updateLead(id: string, patch: LeadPatch): Promise<Result> {
  const user = await requireUser();

  const existing = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!existing) return { ok: false, error: "Lead not found." };

  const updates: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };

  if (patch.companyName !== undefined) updates.companyName = patch.companyName.trim() || null;
  if (patch.contactName !== undefined) updates.contactName = patch.contactName.trim() || null;
  if (patch.title !== undefined) updates.title = patch.title.trim() || null;
  // Phone drives the dedup key + dialing, so keep phoneNormalized in sync.
  const newPhone = patch.phone !== undefined ? patch.phone.trim() || null : undefined;
  if (newPhone !== undefined) {
    updates.phone = newPhone;
    updates.phoneNormalized = newPhone ? normalizePhone(newPhone) : null;
  }
  if (patch.email !== undefined) updates.email = patch.email.trim() || null;
  if (patch.website !== undefined) updates.website = patch.website.trim() || null;

  if (patch.status !== undefined) {
    if (!(LEAD_STATUSES as readonly string[]).includes(patch.status)) {
      return { ok: false, error: "Invalid status." };
    }
    updates.status = patch.status;
  }

  if (patch.callbackAt !== undefined) {
    updates.callbackAt = patch.callbackAt ? new Date(patch.callbackAt) : null;
  }

  try {
    await db.update(leads).set(updates).where(eq(leads.id, id));
  } catch {
    // Most likely the unique phone index — another lead already has this number.
    return { ok: false, error: "Couldn't save — another lead already has that number." };
  }

  // Track a phone change on the timeline (keeps the original number on record).
  if (newPhone !== undefined && (existing.phone ?? "") !== (newPhone ?? "")) {
    await db.insert(leadEvents).values({
      leadId: id,
      userId: user.id,
      type: "system",
      body: `Phone updated: ${existing.phone || "—"} → ${newPhone || "—"}`,
    });
  }

  // Log a status change to the timeline.
  if (patch.status !== undefined && patch.status !== existing.status) {
    await db.insert(leadEvents).values({
      leadId: id,
      userId: user.id,
      type: "status_change",
      body: `Status: ${leadStatusLabel(existing.status)} → ${leadStatusLabel(patch.status)}`,
    });
  }

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true };
}

export async function addLeadNote(id: string, body: string): Promise<Result> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return { ok: false, error: "Note is empty." };

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) return { ok: false, error: "Lead not found." };

  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "note",
    body: text,
  });

  revalidatePath(`/leads/${id}`);
  return { ok: true };
}

/**
 * Manually set/clear a lead's office hours (e.g. learned on the call). Stored
 * as a verified, manual-sourced enrichment field; best-effort parsed into
 * structured periods so the open-now filter can use it.
 */
export async function setOfficeHours(id: string, text: string): Promise<Result> {
  const user = await requireUser();
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) return { ok: false, error: "Lead not found." };

  const value = text.trim();
  const enrichment: LeadEnrichment = { ...(lead.enrichment ?? {}) };
  if (!value) {
    delete enrichment.officeHours;
  } else {
    enrichment.officeHours = {
      value,
      verified: true, // heard directly from the business
      confidence: 0.95,
      sources: [{ name: "manual", url: null, value, at: new Date().toISOString() }],
      periods: parseHoursText(value) ?? undefined,
    };
  }

  await db.update(leads).set({ enrichment, updatedAt: new Date() }).where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: `Office hours ${value ? `set: ${value}` : "cleared"}`,
  });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/dial");
  return { ok: true };
}

/**
 * (Re)generate the lead's Key Notes via Claude, from its enrichment,
 * customFields, and existing notes. Stores the result on the lead.
 */
export async function generateLeadKeyNotes(id: string): Promise<KeyNotesResult> {
  const user = await requireUser();
  if (!isAnthropicConfigured()) {
    return { ok: false, error: "AI is not configured (set ANTHROPIC_API_KEY)." };
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) return { ok: false, error: "Lead not found." };

  // Pull the rich human/import notes for context (newest first).
  const noteRows = await db
    .select({ body: leadEvents.body, type: leadEvents.type })
    .from(leadEvents)
    .where(and(eq(leadEvents.leadId, id), eq(leadEvents.type, "note")))
    .orderBy(desc(leadEvents.createdAt))
    .limit(10);

  const cf = (lead.customFields as Record<string, string> | null) ?? {};
  const notes = noteRows.map((r) => r.body).filter((b): b is string => !!b);
  if (cf["Prospect Notes"]) notes.push(cf["Prospect Notes"]);

  // Fold the most recent call's AI notes in, so the Key Notes triage what was
  // actually learned on prior calls (objections, next steps, pain points).
  const [lastTx] = await db
    .select({ analysis: callTranscripts.analysis })
    .from(callTranscripts)
    .where(eq(callTranscripts.leadId, id))
    .orderBy(desc(callTranscripts.createdAt))
    .limit(1);
  const a = lastTx?.analysis;
  if (a?.summary) notes.push(`Last call summary: ${a.summary}`);
  if (a?.bullets?.length) notes.push(...a.bullets);
  if (a?.objections?.length) notes.push(`Objections raised on a prior call: ${a.objections.join("; ")}`);

  // On-demand review backfill: leads imported via CSV or older harvests have no
  // stored reviews. When Places is configured, look the business up and persist
  // any reviews so the Key Notes below can mine them for pain points / ammo.
  let reviews = lead.reviews ?? [];
  if (!reviews.length && lead.companyName && isPlacesConfigured()) {
    const pl = await placesLookup(lead.companyName, cf.City ?? null);
    if (pl?.reviews?.length) {
      reviews = pl.reviews;
      await db.update(leads).set({ reviews, updatedAt: new Date() }).where(eq(leads.id, id));
    }
  }

  // Angle the notes to the lead's campaign (any vertical), when it has a brief.
  const [camp] = await db
    .select({ brief: campaigns.briefData })
    .from(campaignLeads)
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(campaignLeads.leadId, id))
    .orderBy(asc(campaignLeads.addedAt))
    .limit(1);

  const bullets = await generateKeyNotes({
    companyName: lead.companyName,
    contactName: lead.contactName,
    title: lead.title,
    website: lead.website,
    city: cf.City ?? null,
    customFields: cf,
    enrichment: lead.enrichment,
    notes,
    vertical: camp?.brief?.vertical ?? null,
    offer: camp?.brief?.offer ?? null,
    reviews,
  });

  if (!bullets) {
    return { ok: false, error: "Couldn't generate notes from the available info." };
  }

  await db.update(leads).set({ keyNotes: bullets, updatedAt: new Date() }).where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: "Key notes generated",
    metadata: { source: "ai", count: bullets.length },
  });

  revalidatePath(`/leads/${id}`);
  revalidatePath("/dial");
  return { ok: true, notes: bullets };
}

export async function deleteLead(id: string): Promise<Result> {
  await requireUser();
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
  return { ok: true };
}

/** Discard a lead from dialing/lists (recoverable). */
export async function archiveLead(id: string, reason?: string): Promise<Result> {
  const user = await requireUser();
  await db
    .update(leads)
    .set({ archived: true, archivedReason: reason?.trim() || null, updatedAt: new Date() })
    .where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: `Discarded${reason ? `: ${reason}` : ""}`,
  });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
  return { ok: true };
}

export async function unarchiveLead(id: string): Promise<Result> {
  const user = await requireUser();
  await db
    .update(leads)
    .set({ archived: false, archivedReason: null, updatedAt: new Date() })
    .where(eq(leads.id, id));
  await db.insert(leadEvents).values({
    leadId: id,
    userId: user.id,
    type: "system",
    body: "Restored from discarded",
  });
  revalidatePath(`/leads/${id}`);
  return { ok: true };
}
