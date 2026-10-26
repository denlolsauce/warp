import nodemailer from "nodemailer";

// Shares the same SMTP server as Auth.js's magic-link provider (src/lib/auth.ts)
// rather than a second configuration for one more email.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendProductReadyEmail(to: string, productName: string, productUrl: string): Promise<void> {
  const safeName = escapeHtml(productName);
  const safeUrl = escapeHtml(productUrl);
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Your 3D model of "${productName}" is ready`,
    text: `Your 3D model of "${productName}" has finished processing. View it here: ${productUrl}`,
    html: `<p>Your 3D model of "<strong>${safeName}</strong>" has finished processing.</p><p><a href="${safeUrl}">View it</a></p>`,
  });
}
