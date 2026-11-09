import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SayPay | Invoice anyone. Get paid in Nimiq Pay.",
  description: "Send an invoice link. Your client taps pay in Nimiq Pay. SayPay confirms the payment on chain and marks it paid.",
  metadataBase: new URL("https://saypay-payment-assistant.emerxch.workers.dev"),
  openGraph: {
    title: "SayPay | Invoice anyone. Get paid in Nimiq Pay.",
    description: "Send a link. They tap pay. SayPay confirms it on chain.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("saypay-theme");if(t==="light")document.documentElement.classList.remove("dark");else if(t==="dark")document.documentElement.classList.add("dark");else if(window.matchMedia("(prefers-color-scheme: light)").matches)document.documentElement.classList.remove("dark");}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
