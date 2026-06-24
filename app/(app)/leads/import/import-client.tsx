"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LEAD_FIELDS, guessMapping, type LeadFieldKey } from "@/lib/csv";
import { importLeads, type ImportResult, type ImportRow } from "./actions";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowRight } from "lucide-react";

const IGNORE = "__ignore__";

export function ImportClient({ campaignId }: { campaignId?: string }) {
  const router = useRouter();
  const leadsHref = campaignId ? `/campaigns/${campaignId}/leads` : "/leads";
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, LeadFieldKey | null>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    Papa.parse<ImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(Boolean) as string[];
        if (!hdrs.length) {
          toast.error("Couldn't read any columns from that file.");
          return;
        }
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(res.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim())));
        setMapping(guessMapping(hdrs));
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  }

  function setField(header: string, value: string) {
    setMapping((m) => {
      const next = { ...m };
      const key = value === IGNORE ? null : (value as LeadFieldKey);
      // Enforce one header per field: clear any other header mapped to it.
      if (key) {
        for (const h of Object.keys(next)) if (next[h] === key) next[h] = null;
      }
      next[header] = key;
      return next;
    });
  }

  const phoneMapped = Object.values(mapping).includes("phone");

  function doImport() {
    startTransition(async () => {
      const res = await importLeads(rows, mapping, fileName, campaignId);
      setResult(res);
      if (res.ok) {
        toast.success(`Imported ${res.imported} lead${res.imported === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Import failed.");
      }
    });
  }

  function reset() {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
  }

  if (result?.ok) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-5 text-green-600" />
            Import complete
          </CardTitle>
          <CardDescription>{fileName}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Imported" value={result.imported} highlight />
            <Stat label="Rows in file" value={result.total} />
            <Stat label="Duplicate in file" value={result.duplicatesInFile} />
            <Stat label="Already in CRM" value={result.duplicatesInDb} />
            <Stat label="Missing/invalid phone" value={result.missingPhone} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={() => router.push(leadsHref)}>
              View leads <ArrowRight className="size-4" />
            </Button>
            <Button variant="outline" onClick={reset}>
              Import another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4" /> Upload CSV
          </CardTitle>
          <CardDescription>
            Leads are de-duplicated on phone number (normalized), so re-importing is safe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input type="file" accept=".csv,text/csv" onChange={onFile} className="max-w-sm" />
            {fileName && (
              <Badge variant="secondary" className="gap-1">
                <FileSpreadsheet className="size-3" />
                {fileName} · {rows.length} rows
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Map columns</CardTitle>
            <CardDescription>
              We guessed these from your headers. Phone is required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((h) => (
                <div key={h} className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{h}</Label>
                  <Select value={mapping[h] ?? IGNORE} onValueChange={(v) => setField(h, v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>Ignore (keep as note field)</SelectItem>
                      {LEAD_FIELDS.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                          {"required" in f && f.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Preview</div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h} className="whitespace-nowrap">
                          {h}
                          {mapping[h] && (
                            <span className="ml-1 text-[10px] font-normal text-primary">
                              →{LEAD_FIELDS.find((f) => f.key === mapping[h])?.label}
                            </span>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => (
                          <TableCell key={h} className="whitespace-nowrap text-xs">
                            {r[h]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={doImport} disabled={!phoneMapped || pending}>
                {pending ? "Importing…" : `Import ${rows.length} rows`}
              </Button>
              {!phoneMapped && (
                <span className="text-sm text-destructive">Map a Phone column to continue.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className={`text-lg font-semibold ${highlight ? "text-green-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
