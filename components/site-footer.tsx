import Image from 'next/image';
import { GITHUB_REPO_URL } from '@/lib/github-link';
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href="/" aria-label="ATHENA 홈">
        <Image
          src="/brand/athena.png"
          alt="ATHENA"
          width={138}
          height={41}
          unoptimized
        />
      </a>
      <p className="site-footer-credit">키움증권의 AI 투자 워크스페이스</p>
      <nav className="site-footer-nav" aria-label="하단 메뉴">
        <a href="/features">기능</a>
        <a href="/tech">기술</a>
        <a href="/#resources">자료</a>
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  );
}
