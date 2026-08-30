import { auth } from "./auth";

/**
 * Who may see the admin pages.
 *
 * An env allowlist rather than a role column, deliberately: the schema has no
 * admin concept today, and adding one would need a way to grant it, which is
 * its own admin surface. `Membership.role` is the wrong tool — it scopes a
 * user *within an organisation*, whereas this is site-wide staff access to
 * other people's data.
 *
 * Fails closed. An unset or empty ADMIN_EMAILS means nobody is an admin,
 * including in development — the alternative (empty list means everyone) is
 * the kind of default that quietly ships.
 */
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function currentAdminEmail(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !session?.user?.id) return null;
  return adminEmails().has(email) ? email : null;
}

export async function isAdmin(): Promise<boolean> {
  return (await currentAdminEmail()) !== null;
}

/** True when nobody could possibly be an admin, so the UI can say why. */
export function adminAllowlistIsEmpty(): boolean {
  return adminEmails().size === 0;
}
