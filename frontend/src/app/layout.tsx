import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { ThemeProvider } from "@/lib/theme-provider";
import { AppStoreProvider } from "@/contexts/app-store";
import { SolanaWalletProvider } from "@/contexts/solana-wallet-provider";
import { RootLayoutWrapper } from "@/components/layout/root-layout-wrapper";
import { QueryProvider } from "@/providers/QueryProvider";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FRACKS | Tokenized Real World Assets",
  description:
    "TRex-compatible RWA platform on Solana with Anchor programs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${publicSans.className} ${publicSans.variable} overflow-x-hidden`}
      >
        <ThemeProvider>
          <SolanaWalletProvider>
            <QueryProvider>
              <AppStoreProvider>
                <RootLayoutWrapper>{children}</RootLayoutWrapper>
              </AppStoreProvider>
            </QueryProvider>
          </SolanaWalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
