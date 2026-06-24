import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ac, roles } from "@/lib/permissions";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  // BETTER_AUTH_URL's origin is trusted automatically. In dev we also trust
  // localhost on any port so the port the dev server picks doesn't matter.
  trustedOrigins:
    process.env.NODE_ENV === "development"
      ? ["http://localhost:3000", "http://localhost:3100"]
      : [],
  // Invite-only: email/password is enabled for *login*, but public sign-up
  // is disabled. New accounts are created only by an admin via the admin
  // plugin's createUser endpoint.
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: "worker",
      adminRoles: ["admin"],
    }),
    // Must be last: lets server actions set auth cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
