import { Badge } from "@/components/ui/badge";
import type { LeadStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  // "Attempted" = we've tried (no answer / busy / gatekeeper / mailbox full /
  // couldn't hear) but haven't actually reached them. "Contacted" is the next
  // step up (connected or left a voicemail).
  in_progress: "Attempted",
  contacted: "Contacted",
  callback: "Callback",
  booked: "Booked",
  not_interested: "Not interested",
  do_not_call: "Do not call",
  bad_number: "Bad number",
  closed: "Closed",
};

const STYLES: Record<LeadStatus, string> = {
  new: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  contacted: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  callback: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  booked: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  not_interested: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  do_not_call: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  bad_number: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  closed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function leadStatusLabel(status: LeadStatus) {
  return LABELS[status] ?? status;
}

export function LeadStatusBadge({ status, archived }: { status: LeadStatus; archived?: boolean }) {
  // A discarded lead reads as "Discarded" — not its old pipeline status, so it
  // never lingers as "In progress" in lists once you discard it.
  if (archived) {
    return (
      <Badge
        variant="secondary"
        className="border-transparent bg-zinc-200 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      >
        Discarded
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn("border-transparent font-medium", STYLES[status])}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
