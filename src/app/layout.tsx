import type { Metadata } from "next";
import { Geist, Source_Serif_4 } from "next/font/google";
import { KeepAppearance } from "@/components/keep-appearance";
import { ScrollbarReveal } from "@/components/scrollbar-reveal";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });

// The tagline is Braxton's call (9/26/26, team request 21). Claims here are about the application, never admission.
const DESCRIPTION =
  "Be the average admit. Every college essay and short answer in one place: word counts against each limit, every draft kept, and a board of what's due next.";

export const metadata: Metadata = {
  metadataBase: new URL("https://averageapp.com"),
  title: { default: "Average App", template: "%s · Average App" },
  description: DESCRIPTION,
  openGraph: { title: "Average App", description: DESCRIPTION, siteName: "Average App", type: "website" },
  twitter: { card: "summary_large_image", title: "Average App", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The appearance script sets data attributes before React hydrates: they differ from the server's.
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <ScrollbarReveal />
        <KeepAppearance />
      </body>
    </html>
  );
}
