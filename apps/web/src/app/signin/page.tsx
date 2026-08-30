import { signIn } from "@/lib/auth";

const devSignInEnabled =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_SIGNIN === "true";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  async function handleSignIn(formData: FormData) {
    "use server";
    const email = formData.get("email") as string;
    await signIn("nodemailer", { email, redirectTo: (formData.get("callbackUrl") as string) || "/" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-studio-ink">Sign in</h1>
        <p className="mt-1 text-sm text-studio-muted">We&rsquo;ll email you a link — no password needed.</p>
      </div>

      <form action={handleSignIn} className="flex flex-col gap-3">
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
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
            No SMTP server here — sign in directly as the seeded demo merchant.
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
    </main>
  );
}
