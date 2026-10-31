import './globals.css';
export const metadata = { title: 'CyberQuest AI — Multiplayer Cyber Incident Challenge', description: 'Join your crew in a live cybersecurity incident challenge. Five rounds. Shared evidence. Server-verified scores.' };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en"><body>{children}</body></html>; }
