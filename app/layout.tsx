import type { Metadata } from "next";
import { headers } from "next/headers";
import QuickTools from "./QuickTools";
import "./globals.css";
import "./dashboard-polish.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  return {
    title: "TrackFleet — Delivery tracking made clear",
    description: "Live fleet operations and private customer delivery tracking for small transport teams.",
    openGraph: {
      title: "TrackFleet",
      description: "Delivery tracking made clear.",
      type: "website",
      images: [`${baseUrl}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "TrackFleet",
      description: "Delivery tracking made clear.",
      images: [`${baseUrl}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<QuickTools /></body></html>;
}
