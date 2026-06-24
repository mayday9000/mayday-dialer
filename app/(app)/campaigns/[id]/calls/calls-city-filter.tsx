"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** City filter for the call log — navigates with a ?market= search param so the
 *  server re-queries scoped to one city. */
export function CallsCityFilter({
  markets,
  value,
}: {
  markets: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(v: string) {
    router.push(v === "all" ? pathname : `${pathname}?market=${v}`);
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All cities</SelectItem>
        {markets.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
