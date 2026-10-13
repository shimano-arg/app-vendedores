import type { Metadata } from 'next';
import Image from 'next/image';
import { Geist, Geist_Mono } from 'next/font/google';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { logout } from './login/actions';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Reclamos Shimano',
  description: 'Gestión de reclamos Shimano ↔ Depósito',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {user && (
          <header className="glass sticky top-0 z-30">
            <div className="flex items-center justify-between px-6 py-3">
              <Image
                src="/shimano-logo.png"
                alt="Shimano"
                width={140}
                height={40}
                priority
                className="h-7 w-auto"
              />
              <form action={logout}>
                <button type="submit" className="pill-outline">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span>Salir</span>
                </button>
              </form>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
