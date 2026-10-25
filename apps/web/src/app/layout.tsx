import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Show Me Once',
  description: 'Record browser tasks and turn them into reusable skills.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
