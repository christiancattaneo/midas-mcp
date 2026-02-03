import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"

declare module "next-auth" {
  interface Session {
    user: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      githubId?: number
      githubUsername?: string
    }
  }
}

interface GitHubProfile {
  id: number
  login: string
  avatar_url: string
  name: string
  email: string
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const ghProfile = profile as unknown as GitHubProfile
        token.githubId = ghProfile.id
        token.githubUsername = ghProfile.login
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubId = token.githubId as number
        session.user.githubUsername = token.githubUsername as string
      }
      return session
    },
  },
})
