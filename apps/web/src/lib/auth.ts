import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    // Database session strategy hands the callback {session, user} — but
    // Auth.js doesn't copy user.id onto session.user by default, and this
    // app's routes all gate on session.user.id.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
