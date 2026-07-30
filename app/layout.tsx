import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SayPay | Payments in plain language",
  description: "Create, review, and confirm payments with simple language.",
  metadataBase: new URL("https://saypay-payment-assistant.peacenft7.chatgpt.site"),
  openGraph: {
    title: "SayPay | Payments in plain language",
    description: "Say what you want to pay. Review it clearly. Confirm it securely.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SayPay | Payments in plain language",
    description: "Say what you want to pay. Review it clearly. Confirm it securely.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
