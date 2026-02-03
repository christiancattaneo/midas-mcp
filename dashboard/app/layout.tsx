import type { Metadata } from 'next'
import './globals.css'
import { MatrixRain } from '@/components/MatrixRain'

export const metadata: Metadata = {
  title: 'Midas Dashboard',
  description: 'Track your development progress across all projects',
}

// Script to prevent flash of wrong theme
const themeScript = `
  (function() {
    const stored = localStorage.getItem('midas-theme');
    const theme = stored || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  })();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <MatrixRain />
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  )
}
