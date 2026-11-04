import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Shuttle Note｜チームの試合記録',description:'メンバーと試合結果を、チームでひとつの記録に。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>}
