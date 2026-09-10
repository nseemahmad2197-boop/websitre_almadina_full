import type { Metadata } from "next";
import "./globals.css";

// Nonces must be generated per response, never reused from prerendered HTML.
export const dynamic = "force-dynamic";

const title = "المدينة إكسبرس | Almadina Express";
const description =
  "منصة المدينة إكسبرس لإدارة الطرود، إنشائها، تتبع التوصيل، ومتابعة عمليات الشحن داخل فلسطين.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "المدينة إكسبرس",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "المدينة إكسبرس",
  },
  keywords: ["المدينة إكسبرس", "توصيل", "شحن", "فلسطين", "تتبع الطرود"],
  icons: {
    icon: [
      { url: "/almadina-mark.svg", type: "image/svg+xml" },
      { url: "/almadina-icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/almadina-icon-192.png",
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: { title, description, locale: "ar_PS", type: "website" },
  twitter: { card: "summary", title, description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#087c45" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
