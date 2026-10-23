import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Cortes Automáticos", template: "%s · Cortes Automáticos" },
  description: "Gere, revise e publique cortes verticais legendados a partir dos seus vídeos.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0d0f10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
