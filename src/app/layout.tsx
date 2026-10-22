import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/sw-register";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, DESCRIPTION, SITE_URL, TITLE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s | ${APP_NAME}` },
  description: DESCRIPTION,
  applicationName: APP_NAME,
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: APP_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/opengraph-image`],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-black text-white">
        {children}
        <Toaster position="top-center" />
        <ServiceWorker />
      </body>
    </html>
  );
}
