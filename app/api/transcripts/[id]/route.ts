import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { callTranscripts, leads } from "@/lib/db/schema";
import { getSession } from "@/lib/auth-server";
import { segmentsToText, segmentsToVtt, transcriptFilenameStem } from "@/lib/transcripts";

export const runtime = "nodejs";

/** Authenticated transcript download. ?format=txt|json|vtt (default txt). */
export async function GET(req: Request, ctx: RouteContext<"/api/transcripts/[id]">) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const [row] = await db
    .select({
      id: callTranscripts.id,
      segments: callTranscripts.segments,
      text: callTranscripts.text,
      createdAt: callTranscripts.createdAt,
      source: callTranscripts.source,
      language: callTranscripts.language,
      company: leads.companyName,
      contact: leads.contactName,
    })
    .from(callTranscripts)
    .leftJoin(leads, eq(leads.id, callTranscripts.leadId))
    .where(eq(callTranscripts.id, id))
    .limit(1);

  if (!row) return new NextResponse("Not found", { status: 404 });

  const format = (new URL(req.url).searchParams.get("format") || "txt").toLowerCase();
  const stem = transcriptFilenameStem({ company: row.company, contact: row.contact, at: row.createdAt });
  const segments = row.segments ?? [];

  let body: string;
  let contentType: string;
  let ext: string;

  if (format === "json") {
    body = JSON.stringify(
      {
        id: row.id,
        source: row.source,
        language: row.language,
        recordedAt: row.createdAt,
        company: row.company,
        contact: row.contact,
        segments,
      },
      null,
      2,
    );
    contentType = "application/json";
    ext = "json";
  } else if (format === "vtt") {
    body = segmentsToVtt(segments);
    contentType = "text/vtt";
    ext = "vtt";
  } else {
    const header = [
      row.company || row.contact || "Call transcript",
      `Recorded: ${new Date(row.createdAt).toLocaleString()}`,
      `Source: ${row.source}`,
      "",
    ].join("\n");
    body = header + (segments.length ? segmentsToText(segments) : row.text || "(empty)");
    contentType = "text/plain";
    ext = "txt";
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${stem}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
