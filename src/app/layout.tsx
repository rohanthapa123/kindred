import type { Metadata, Viewport } from "next";
import { Anton, Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body" });
const meme = Anton({ subsets: ["latin"], variable: "--font-meme", weight: "400" });

export const metadata: Metadata = {
  title: "Kindred — the word-closeness game",
  description: "Find the secret word. Every guess tells you how close in meaning you are.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#17172b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${meme.variable}`}>
      <body>{children}</body>
    </html>
  );
}
