/**
 * Bootstrap / manage an admin account.
 *
 *   pnpm seed:admin -- --email you@example.com --name "You" --password "secret123"
 *
 * Public sign-up is disabled (invite-only), so the very first admin can't be
 * created through the normal flow. This seeds one directly via Better Auth's
 * server context, which hashes the password the same way login expects.
 *
 * Idempotent and self-healing: if the user already exists it promotes them to
 * admin, resets the password, and de-duplicates any stray credential accounts.
 *
 * Robustness note: instead of relying on findUserByEmail(...).accounts (which
 * was observed to return zero accounts for a perfectly valid login-able user,
 * causing this script to create a SECOND credential row and break logins), we
 * query the `account` table directly via drizzle.
 */
import { and, eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { account, user } from "../lib/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email") ?? process.env.ADMIN_EMAIL;
  const password = arg("password") ?? process.env.ADMIN_PASSWORD;
  const name = arg("name") ?? process.env.ADMIN_NAME ?? "Admin";

  if (!email || !password) {
    console.error("Usage: seed:admin -- --email <email> --password <pw> [--name <name>]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(password);

  // Better Auth lowercases emails on write, so match the same way.
  const normalizedEmail = email.toLowerCase();

  // --- Resolve / create the user (drizzle directly, not findUserByEmail) ---
  const existingUsers = await db
    .select()
    .from(user)
    .where(eq(user.email, normalizedEmail));

  let userCreated = false;
  let uid: string;

  if (existingUsers.length > 0) {
    uid = existingUsers[0].id;
    // Promote to admin + mark verified (idempotent).
    await ctx.internalAdapter.updateUser(uid, { role: "admin", emailVerified: true });
  } else {
    const created = await ctx.internalAdapter.createUser({
      email: normalizedEmail,
      name,
      emailVerified: true,
      role: "admin",
    });
    uid = created.id;
    userCreated = true;
  }

  // --- Reconcile credential accounts directly against the account table ---
  const creds = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, uid), eq(account.providerId, "credential")));

  let action: "created" | "updated";
  let dedupedCount = 0;
  let credentialAccountId: string;

  if (creds.length === 0) {
    // No credential account yet — create one.
    let createdAccountId: string;
    try {
      const acct = await ctx.internalAdapter.createAccount({
        userId: uid,
        providerId: "credential",
        accountId: uid,
        password: hashed,
      });
      createdAccountId = acct.id;
    } catch {
      // Fallback for any signature drift in this Better Auth version: insert
      // the credential row directly.
      const id = crypto.randomUUID();
      await db.insert(account).values({
        id,
        accountId: uid,
        providerId: "credential",
        userId: uid,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdAccountId = id;
    }
    credentialAccountId = createdAccountId;
    action = "created";
  } else {
    // Keep the first credential row; delete any extras (the duplicate bug).
    const [keep, ...extras] = creds;
    if (extras.length > 0) {
      const extraIds = extras.map((a) => a.id);
      await db.delete(account).where(inArray(account.id, extraIds));
      dedupedCount = extraIds.length;
    }
    await db
      .update(account)
      .set({ password: hashed, updatedAt: new Date() })
      .where(eq(account.id, keep.id));
    credentialAccountId = keep.id;
    action = "updated";
  }

  // --- Summary ---
  const verb = userCreated ? "Created" : "Updated";
  const parts = [
    `${verb} ${normalizedEmail} -> admin`,
    `credential ${action}`,
  ];
  if (dedupedCount > 0) parts.push(`deduped(${dedupedCount} removed)`);
  console.log(`✓ ${parts.join(" | ")}`);
  console.log(`  user id:               ${uid}`);
  console.log(`  credential account id: ${credentialAccountId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed to seed admin:", e);
  process.exit(1);
});
