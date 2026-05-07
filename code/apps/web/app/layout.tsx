import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { TimerWidget } from '@/components/time/timer-widget';

// Το όνομα του προϊόντος από μεταβλητή περιβάλλοντος — naming-neutral
const productName = process.env['PRODUCT_NAME'] ?? 'ΘΕΜΙΣ OS';
const productDomain = process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr';

export const metadata: Metadata = {
  title: {
    default: productName,
    template: `%s | ${productName}`,
  },
  description: 'Λογισμικό Διαχείρισης Δικηγορικού Γραφείου',
  metadataBase: new URL(`https://${productDomain}`),
  robots: {
    // Κλειστό σύστημα Phase 1 — δεν θέλουμε indexing ακόμα
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a1a2e',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  // Read firm slug injected by middleware — needed by client-side API fetch wrapper
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  return (
    // Greek locale ως default — Invariant #7
    <html lang="el" className="h-full">
      <head>
        {/* x-firm-slug meta tag — read by clientFetch() in client components */}
        {firmSlug !== null && (
          <meta name="x-firm-slug" content={firmSlug} />
        )}
      </head>
      <body className="h-full bg-gray-50 text-gray-900 antialiased">
        {children}
        {/* Timer widget — persistent floating, visible σε όλες τις authenticated pages */}
        <TimerWidget />
      </body>
    </html>
  );
}
