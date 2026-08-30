import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import { signIn } from "@/lib/auth";

const devSignInEnabled =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_SIGNIN === "true";

// Auth.js error codes surface as ?error=… on this page (pages.error === /signin).
// Anything unmapped gets the generic line rather than a raw code.
const ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Email sign-in isn't configured on this server, so the magic link couldn't be sent.",
  EmailSignin: "We couldn't send that email. Check the address and try again.",
  AccessDenied: "That account isn't allowed to sign in.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; sent?: string }>;
}) {
  const { callbackUrl, error, sent } = await searchParams;
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong signing you in. Try again.")
    : null;

  async function handleSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const target = String(formData.get("callbackUrl") ?? "") || "/studio";
    try {
      await signIn("nodemailer", { email, redirectTo: target });
    } catch (cause) {
      // signIn signals success by throwing a redirect — only real failures
      // (usually SMTP being unreachable) should land on the error state.
      if (isRedirectError(cause)) throw cause;
      const code = cause instanceof Error && "type" in cause ? String(cause.type) : "EmailSignin";
      redirect(
        `/signin?error=${encodeURIComponent(code)}&callbackUrl=${encodeURIComponent(target)}`,
      );
    }
  }

  return (
    <main className="studio flex min-h-screen w-full justify-center bg-studio-bg px-6 font-studio">
      <div className="flex w-full max-w-md flex-col justify-center gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-studio-ink">Sign in</h1>
          <p className="mt-1 text-sm text-studio-muted">
            We&rsquo;ll email you a link — no password needed.
          </p>
        </div>

        {errorMessage ? (
          <p className="rounded-lg border border-studio-line bg-studio-red-bg px-3 py-2 text-sm text-studio-red">
            {errorMessage}
          </p>
        ) : null}

        {sent ? (
          <p className="rounded-lg border border-studio-line bg-studio-green-bg px-3 py-2 text-sm text-studio-green">
            Check your inbox for the sign-in link.
          </p>
        ) : null}

        <form action={handleSignIn} className="flex flex-col gap-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/studio"} />
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autoFocus
            className="rounded-lg border border-studio-line bg-white px-3 py-2 text-sm text-studio-ink outline-none focus:border-studio-brand"
          />
          <button
            type="submit"
            className="rounded-lg bg-studio-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Send magic link
          </button>
        </form>

        {devSignInEnabled ? (
          <form
            action="/api/auth/dev-signin"
            method="post"
            className="flex flex-col gap-2 rounded-lg border border-dashed border-studio-line p-4"
          >
            <p className="text-xs uppercase tracking-wide text-studio-muted">Development only</p>
            <p className="text-sm text-studio-muted">
              No mail server is running here, so magic links can&rsquo;t be delivered. Sign in
              directly as the seeded demo merchant instead.
            </p>
            <input type="hidden" name="email" value="test@portal.dev" />
            <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/studio"} />
            <button
              type="submit"
              className="rounded-lg border border-studio-line bg-white px-3 py-2 text-sm font-medium text-studio-ink hover:bg-studio-well"
            >
              Continue as test@portal.dev
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
