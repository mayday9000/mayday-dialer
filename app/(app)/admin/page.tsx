import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { UsersClient } from "./users-client";

export default async function AdminPage() {
  const admin = await requireAdmin();

  const result = await auth.api.listUsers({
    query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
    headers: await headers(),
  });

  const users = (result.users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u as { role?: string | null }).role ?? "worker",
    createdAt: new Date(u.createdAt).toISOString(),
  }));

  return (
    <div className="flex flex-col">
      <PageHeader title="Admin" description="Manage who can access the dialer." />
      <div className="p-6">
        <UsersClient users={users} currentUserId={admin.id} />
      </div>
    </div>
  );
}
