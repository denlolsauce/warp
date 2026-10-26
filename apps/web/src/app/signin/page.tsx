import Link from "next/link";
import { signIn } from "@/lib/auth";
import { Icon } from "@/components/workspace/Icon";
import "@/components/workspace/workspace.css";

export default function SignInPage({ searchParams }: { searchParams: { callbackUrl?: string; error?: string } }) {
  const configured = Boolean(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_FROM);
  const callbackUrl = searchParams.callbackUrl && /^\/(?!\/)/.test(searchParams.callbackUrl) ? searchParams.callbackUrl : "/";
  async function handleSignIn(formData: FormData) {
    "use server";
    if (!process.env.EMAIL_SERVER_HOST || !process.env.EMAIL_FROM) return;
    const email = formData.get("email");
    if (typeof email !== "string") return;
    await signIn("nodemailer", { email: email.trim(), redirectTo: callbackUrl });
  }
  return <main className="suite signin-page"><Link href="/" className="brand"><span className="brand-mark"><Icon name="cube" size={23}/></span><span>warp<span className="brand-dot">.</span></span></Link><section className="signin-card"><span className="eyebrow">WELCOME TO YOUR WORKSPACE</span><h1>A clearer view starts here.</h1><p>Sign in with your work email. We’ll send a secure link — no password needed.</p><form action={handleSignIn}><label>Work email<input type="email" name="email" required maxLength={254} placeholder="you@company.com" autoComplete="email" disabled={!configured}/></label><button type="submit" className="button primary full-width" disabled={!configured}>Send sign-in link <Icon name="arrow" size={16}/></button></form>{!configured && <p className="inline-error">Email sign-in isn’t connected in this environment. You can explore the sample, or open a local development workspace in Settings when enabled.</p>}{searchParams.error && <p className="inline-error" role="alert">We couldn’t send that sign-in link. Check your email and try again, or contact your workspace administrator.</p>}<Link className="text-link" href="/?view=settings">← Back to workspace settings</Link><div className="signin-privacy"><Icon name="lock" size={13}/>Your projects are private until you choose to share.</div></section></main>;
}
