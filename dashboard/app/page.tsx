import { auth, signIn } from "@/auth"
import { redirect } from "next/navigation"
import { ThemeToggle } from "@/components/ThemeToggle"

export default async function Home() {
  const session = await auth()
  
  if (session?.user) {
    redirect("/dashboard")
  }
  
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 relative">
      {/* Theme toggle */}
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      
      <div className="text-center max-w-xl">
        {/* Logo with glitch effect */}
        <h1 
          className="logo-text glitch neon-gold mb-4"
          data-text="MIDAS"
        >
          MIDAS
        </h1>
        
        {/* Tagline */}
        <p className="text-lg mb-2 text-gold font-mono tracking-wider">
          GOLDEN CODE METHODOLOGY
        </p>
        <p className="text-dim text-sm font-mono mb-12 max-w-md mx-auto">
          {'>'} Transform your development workflow. Track progress. Ship faster.
        </p>
        
        {/* Login card */}
        <div className="card max-w-sm mx-auto">
          <div className="text-left mb-6">
            <p className="text-dim text-xs font-mono mb-1">// AUTHENTICATION REQUIRED</p>
            <p className="text-sm text-secondary">
              Connect your GitHub to sync projects and track progress across devices.
            </p>
          </div>
          
          <form
            action={async () => {
              "use server"
              await signIn("github")
            }}
          >
            <button 
              type="submit"
              className="btn-primary w-full"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              INITIALIZE WITH GITHUB
            </button>
          </form>
        </div>
        
        {/* CLI sync info */}
        <div className="mt-12 text-left max-w-sm mx-auto">
          <p className="text-dim text-xs font-mono mb-3">// CLI COMMANDS</p>
          <div className="space-y-2 font-mono text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gold">$</span>
              <code className="flex-1">npx midas-mcp login</code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gold">$</span>
              <code className="flex-1">npx midas-mcp sync</code>
            </div>
          </div>
        </div>
        
        {/* Version info */}
        <p className="mt-12 text-dim text-xs font-mono">
          v1.0.0 // OPERATIONAL
        </p>
      </div>
    </main>
  )
}
