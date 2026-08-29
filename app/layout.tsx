import type { Metadata } from "next";
import "./globals.css";

const title = "المدينة إكسبرس | Almadina Express";
const description =
  "منصة المدينة إكسبرس لإدارة الطرود، إنشائها، تتبع التوصيل، ومتابعة عمليات الشحن داخل فلسطين.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "المدينة إكسبرس",
  keywords: ["المدينة إكسبرس", "توصيل", "شحن", "فلسطين", "تتبع الطرود"],
  icons: { icon: "/almadina-mark.svg", shortcut: "/almadina-mark.svg" },
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
      </head>
      <body>{children}</body>
    </html>
  );
}
