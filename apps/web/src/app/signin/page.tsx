import { signIn } from "@/lib/auth";

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  async function handleSignIn(formData: FormData) {
    "use server";
    const email = formData.get("email") as string;
    await signIn("nodemailer", { email, redirectTo: searchParams.callbackUrl ?? "/" });
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>We&rsquo;ll email you a link — no password needed.</p>
      <form action={handleSignIn}>
        <input type="email" name="email" required placeholder="you@example.com" autoFocus />
        <button type="submit">Send magic link</button>
      </form>
    </main>
  );
}
