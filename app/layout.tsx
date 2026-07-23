import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swara Adhyaaya · Carnatic Saxophone Library",
  description:
    "Carnatic music lessons, aligned swaras, tala-aware notation, and MuseScore editions for alto saxophone.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
