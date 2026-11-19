import { Poppins } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ui';
import SplashScreen from '@/components/SplashScreen';

// Geometric display face for the ToolkitGo wordmark (self-hosted by Next.js at build time).
const brandFont = Poppins({ subsets: ['latin'], weight: ['500', '800'], variable: '--font-brand', display: 'swap' });

export const metadata = {
  title: 'ToolkitGo — Technician Onboarding',
  description: 'ToolkitGo — simplifying everyday services. Register as a technician and complete your KYC.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#101b3f' };

// Runs before first paint: if the splash was already shown this session, hide it via CSS (no flash).
const splashSeenScript = `try{if(sessionStorage.getItem('tg-splash-seen'))document.documentElement.dataset.splashSeen='1'}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={brandFont.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashSeenScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <SplashScreen />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
