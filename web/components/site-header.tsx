'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Network,
  Shield,
  Puzzle,
  ChartNoAxesCombined,
  Bell,
  ArrowUpRight,
  BookOpenText,
} from 'lucide-react';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import { features } from '@/lib/content';
import { techArticles } from '@/lib/tech-articles';
const icons = [
  MessageSquare,
  Network,
  Shield,
  Puzzle,
  ChartNoAxesCombined,
  Bell,
];
export function SiteHeader() {
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const scroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last.current) > 12) {
        setHidden(y > 200 && y > last.current);
        last.current = y;
      }
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);
  return (
    <header
      className={`site-header${hidden && !menu ? ' header-hidden' : ''}`}
      onFocusCapture={() => setHidden(false)}
    >
      <a href="/" className="brand" aria-label="ATHENA 홈">
        <Image
          src="/brand/athena.png"
          alt="ATHENA"
          width={136}
          height={41}
          unoptimized
          priority
        />
      </a>
      <NavigationMenu
        className="main-nav"
        value={menu}
        onValueChange={setMenu}
        aria-label="메인 메뉴"
      >
        <NavigationMenuList>
          <NavigationMenuItem value="features">
            <NavigationMenuTrigger className="nav-trigger">
              기능
            </NavigationMenuTrigger>
            <NavigationMenuContent className="mega-content">
              <div className="mega-layout">
                <div className="mega-intro">
                  <h2>
                    여섯 가지 역량으로
                    <br />
                    이어지는 투자 작업.
                  </h2>
                  <NavigationMenuLink
                    href="/features"
                    className="overview-link"
                    onClick={() => setMenu(null)}
                  >
                    전체 기능 보기 <ArrowUpRight size={15} />
                  </NavigationMenuLink>
                </div>
                <div className="mega-links">
                  <span>기능</span>
                  {features.map((f, i) => {
                    const Icon = icons[i];
                    return (
                      <NavigationMenuLink
                        key={f.slug}
                        href={`/features/${f.slug}`}
                        className="mega-link"
                        onClick={() => setMenu(null)}
                      >
                        <Icon size={19} aria-hidden="true" />
                        <span className="mega-link-label">{f.label}</span>
                      </NavigationMenuLink>
                    );
                  })}
                </div>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="tech">
            <NavigationMenuTrigger className="nav-trigger">
              기술
            </NavigationMenuTrigger>
            <NavigationMenuContent className="mega-content">
              <div className="mega-layout">
                <div className="mega-intro">
                  <h2>
                    ATHENA를 만드는
                    <br />
                    세 가지 AI 기술.
                  </h2>
                  <NavigationMenuLink
                    href="/tech"
                    className="overview-link"
                    onClick={() => setMenu(null)}
                  >
                    기술문서 전체 보기 <ArrowUpRight size={15} />
                  </NavigationMenuLink>
                </div>
                <div className="mega-links">
                  <span>기술</span>
                  {techArticles.map((article) => (
                    <NavigationMenuLink
                      key={article.slug}
                      href={`/tech/${article.slug}`}
                      className="mega-link"
                      onClick={() => setMenu(null)}
                    >
                      <BookOpenText size={19} />
                      {article.title}
                      <ArrowUpRight size={17} />
                    </NavigationMenuLink>
                  ))}
                </div>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink
              href="/#resources"
              className="nav-trigger nav-resource-link"
            >
              자료
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
      <Image
        className="kiwoom"
        src="/brand/daoukiwoom-group.png"
        alt="다우키움그룹"
        width={162}
        height={28}
        style={{ height: 'auto' }}
        unoptimized
      />
    </header>
  );
}
