import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
};

/** Returns the current session or null. `headers()` is async in Next 16. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Require any authenticated user; redirect to /login otherwise. */
export async function requireUser(): Promise<AuthUser> {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const u = session.user as { id: string; name: string; email: string; role?: string | null };
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? null };
}

/** Require an admin; redirect non-admins to the app home. */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
