import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Midas Dashboard',
  description: 'Track your development progress across all projects',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
