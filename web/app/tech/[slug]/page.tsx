import { notFound } from 'next/navigation';
import { techArticles } from '@/lib/tech-articles';
import { TechSlideGallery } from '@/components/tech-slide-gallery';

export function generateStaticParams() {
  return techArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = techArticles.find((item) => item.slug === slug);
  return {
    title: article ? `${article.title} — ATHENA Tech` : '기술문서를 찾을 수 없습니다.',
    description: article?.description,
  };
}

export default async function TechArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const articleIndex = techArticles.findIndex((item) => item.slug === slug);
  if (articleIndex < 0) notFound();

  const article = techArticles[articleIndex];
  const previous = techArticles[articleIndex - 1];
  const next = techArticles[articleIndex + 1];

  const outline = (
    <ol>
      {article.outline.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`}>
            <span>{item.label}</span>
            {item.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <main id="main" className="tech-document">
      <nav className="tech-breadcrumb" aria-label="현재 위치">
        <a href="/tech">Tech</a>
        <span aria-hidden="true">/</span>
        <span>{article.title}</span>
      </nav>

      <header className="tech-article-header">
        <p className="tech-kicker">Technical note {String(articleIndex + 1).padStart(2, '0')}</p>
        <h1>{article.title}</h1>
        <p className="tech-article-lead">{article.description}</p>
        <div className="blog-tech-stack" aria-label="연결된 제품 모드">
          {article.modes.map((mode) => <span key={mode}>{mode}</span>)}
        </div>
        <div className="tech-question">
          <span>이 문서가 답하는 질문</span>
          <p>{article.question}</p>
        </div>
        <ul className="tech-summary" aria-label="핵심 요약">
          {article.summary.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </header>

      <details className="tech-mobile-outline">
        <summary>문서 목차</summary>
        {outline}
      </details>

      <div className="tech-article-grid">
        <aside className="tech-article-aside" aria-label="문서 목차">
          <p>On this page</p>
          {outline}
          <a className="tech-all-link" href="/tech">모든 기술문서</a>
        </aside>

        <div className="tech-article-body">
          <TechSlideGallery slug={article.slug} />
          <div
            className="tech-article-content"
            dangerouslySetInnerHTML={{ __html: article.html }}
          />

          <section className="tech-related" aria-labelledby="related-title">
            <p className="tech-kicker">Related capabilities</p>
            <h2 id="related-title">제품에서 이어서 보기</h2>
            <div>
              {article.relatedCapabilities.map((capability) => (
                <a href={capability.href} key={capability.href}>
                  <strong>{capability.name}</strong>
                  <span>{capability.description}</span>
                </a>
              ))}
            </div>
          </section>
        </div>
      </div>

      <nav className="tech-article-navigation" aria-label="기술문서 이동">
        {previous ? (
          <a href={`/tech/${previous.slug}`}>
            <span>이전 글</span>
            {previous.title}
          </a>
        ) : <span />}
        {next ? (
          <a href={`/tech/${next.slug}`}>
            <span>다음 글</span>
            {next.title}
          </a>
        ) : (
          <a href="/tech">
            <span>Tech</span>
            전체 기술문서 보기
          </a>
        )}
      </nav>
    </main>
  );
}
