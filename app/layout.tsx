import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gen Studio",
  description: "AI video production · LoRA pipeline · scene rendering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* flex row puts the persistent sidebar on the left and the page on the
          right. min-w-0 on the page column lets long content (queue table,
          long scene titles) shrink/scroll instead of stretching the row. */}
      <body className="min-h-full flex">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
