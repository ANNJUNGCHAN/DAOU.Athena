import Image from 'next/image';
import {
  Activity,
  FileQuestion,
  Network,
  PencilLine,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { Reveal } from '@/components/reveal';
import {
  productPageCopy,
  type ProductSubfeature,
} from '@/lib/product-page-copy';
import './product-feature-gallery.css';

const subfeatureIcons: Record<ProductSubfeature['icon'], LucideIcon> = {
  'file-question': FileQuestion,
  sliders: SlidersHorizontal,
  network: Network,
  pencil: PencilLine,
  activity: Activity,
  search: Search,
};

export function ProductFeatureGallery({ slug }: { slug: string }) {
  const copy = productPageCopy[slug];
  if (!copy) return null;

  return (
    <section
      id="product-capabilities"
      className="pf-section"
      aria-labelledby="product-capabilities-title"
    >
      <div className="wrap pf-heading">
        <Reveal>
          <p className="pf-mode">ATHENA {copy.name}</p>
          <h2 id="product-capabilities-title">주요 기능</h2>
          <p className="pf-intro">{copy.intro}</p>
        </Reveal>
      </div>

      <div className="wide-wrap pf-main-grid">
        {copy.mainFeatures.map((feature, index) => (
          <Reveal
            key={feature.title}
            className={`pf-main-feature${index === 0 ? ' pf-main-feature-wide' : ''}`}
          >
            <figure className="pf-visual">
              <Image
                src={feature.image}
                alt={feature.imageAlt}
                width={1536}
                height={1024}
                sizes={
                  index === 0
                    ? '(max-width: 700px) 100vw, 1440px'
                    : '(max-width: 900px) 100vw, 700px'
                }
                unoptimized
              />
            </figure>
            <div className="pf-copy">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          </Reveal>
        ))}
      </div>

      {copy.subfeatures?.length ? (
        <div
          className="wrap pf-subfeatures"
          aria-labelledby="product-subfeatures-title"
        >
          <Reveal className="pf-subheading">
            <h2 id="product-subfeatures-title">함께 쓰는 기능</h2>
          </Reveal>
          <div className="pf-subgrid">
            {copy.subfeatures.map((feature) => {
              const Icon = subfeatureIcons[feature.icon];
              return (
                <Reveal key={feature.title} className="pf-subfeature">
                  <Icon aria-hidden="true" size={28} strokeWidth={1.6} />
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
