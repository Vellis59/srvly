import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";
import { accounts, sessions, users, verificationTokens } from "@/server/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, account }) {
      // Use the GitHub numeric ID as the persistent user identifier
      if (account?.providerAccountId) {
        token.sub = account.providerAccountId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.sub!;
      return session;
    },
  },
});
