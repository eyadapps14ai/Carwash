import "./globals.css";
import DialogAccessibility from "./dialog-accessibility";
export const metadata = {
  title: "Protune | Business management",
  description: "Protune Auto Services operations and financial control",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DialogAccessibility />
        {children}
      </body>
    </html>
  );
}
