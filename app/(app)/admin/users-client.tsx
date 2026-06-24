"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createWorker, removeWorker, setUserRole } from "./actions";
import { UserPlus, Trash2 } from "lucide-react";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: string;
};

export function UsersClient({
  users,
  currentUserId,
}: {
  users: AdminUser[];
  currentUserId: string;
}) {
  const [role, setRole] = useState("worker");
  const [pending, startTransition] = useTransition();

  function onCreate(formData: FormData) {
    formData.set("role", role);
    startTransition(async () => {
      const res = await createWorker(formData);
      if (res.ok) {
        toast.success("Account created");
        (document.getElementById("create-user-form") as HTMLFormElement)?.reset();
        setRole("worker");
      } else {
        toast.error(res.error);
      }
    });
  }

  function onRemove(userId: string, email: string) {
    if (!confirm(`Remove ${email}? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await removeWorker(userId);
      if (res.ok) toast.success("Account removed");
      else toast.error(res.error);
    });
  }

  function onRoleChange(userId: string, newRole: "admin" | "worker") {
    startTransition(async () => {
      const res = await setUserRole(userId, newRole);
      if (res.ok) toast.success("Role updated");
      else toast.error(res.error);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>{users.length} member(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.id === currentUserId ? (
                      <Badge variant="secondary">{u.role ?? "worker"} (you)</Badge>
                    ) : (
                      <Select
                        defaultValue={u.role ?? "worker"}
                        onValueChange={(v) => onRoleChange(u.id, v as "admin" | "worker")}
                        disabled={pending}
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="worker">worker</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.id !== currentUserId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(u.id, u.email)}
                        disabled={pending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" />
            Invite a worker
          </CardTitle>
          <CardDescription>Creates an account with a starter password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="create-user-form" action={onCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Jane Caller" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="jane@team.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Starter password</Label>
              <Input
                id="password"
                name="password"
                type="text"
                required
                minLength={8}
                placeholder="≥ 8 characters"
              />
              <p className="text-xs text-muted-foreground">Share securely; they can change it later.</p>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">worker</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creating…" : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
