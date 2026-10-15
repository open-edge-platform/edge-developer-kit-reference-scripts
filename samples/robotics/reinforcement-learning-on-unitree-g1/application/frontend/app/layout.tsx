import { Geist, Geist_Mono } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { AppProviders } from "@/app/providers"
import { ThemeProvider } from "@/components/theme-provider"
import { WorkspaceHeader } from "@/components/workspace-header"
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Video2Humanoid RL | Intel",
  description: "Video processing and training workspace for humanoid motion imitation.",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <ThemeProvider>
          <AppProviders>
            <WorkspaceHeader />
            {children}
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  )
}
