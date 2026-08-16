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

export async function sendTourReadyEmail(to: string, tourName: string, tourUrl: string): Promise<void> {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Your tour "${tourName}" is ready`,
    text: `Your Portal tour "${tourName}" has finished processing. View it here: ${tourUrl}`,
    html: `<p>Your Portal tour "<strong>${tourName}</strong>" has finished processing.</p><p><a href="${tourUrl}">View your tour</a></p>`,
  });
}
