import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

/**
 * Two roles for this app:
 *  - admin:  full access incl. user management (admin plugin statements)
 *  - worker: a normal caller; no user-management permissions
 *
 * Defining them through access-control makes "worker" a first-class,
 * type-safe role (the plugin's built-in union is only user/admin).
 */
const statement = {
  ...defaultStatements,
} as const;

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
  ...adminAc.statements,
});

export const worker = ac.newRole({
  // Workers manage leads/calls/bookings (enforced in app code, not via the
  // admin plugin), so they hold no admin-plugin permissions here.
});

export const roles = { admin, worker };
