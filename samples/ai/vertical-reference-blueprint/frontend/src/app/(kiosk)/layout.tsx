// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "../globals.css";
import { Providers } from "@/components/providers";
import { THEME_COOKIE } from "@/lib/theme";

// next/font needs literal subsets, so every shipped country pack's script is loaded.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Public Service Kiosk",
  description:
    "Self-service terminal for licenses, registrations, certificates and payments.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Set server-side so the class is in the first-paint HTML — see src/lib/theme.ts.
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "dark";

  return (
    <html
      lang={process.env.NEXT_PUBLIC_KIOSK_LANG ?? "en"}
      suppressHydrationWarning
      className={`${ibmPlexSans.variable} ${spaceGrotesk.variable} h-full font-sans antialiased${
        dark ? " dark" : ""
      }`}
    >
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
