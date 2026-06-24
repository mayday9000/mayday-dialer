"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createWorker(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const email = String(formData.get("email") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "worker");

  if (!email || !password) return { ok: false, error: "Email and password are required." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  try {
    await auth.api.createUser({
      body: { email, password, name: name || email, role: role as "admin" | "worker" },
      headers: await headers(),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create user." };
  }
}

export async function removeWorker(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (admin.id === userId) return { ok: false, error: "You can't remove your own account." };

  try {
    await auth.api.removeUser({ body: { userId }, headers: await headers() });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to remove user." };
  }
}

export async function setUserRole(userId: string, role: "admin" | "worker"): Promise<ActionResult> {
  await requireAdmin();
  try {
    await auth.api.setRole({ body: { userId, role }, headers: await headers() });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update role." };
  }
}
