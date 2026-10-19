'use client';

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
import { FeatureVideo } from '@/components/feature-video';
import { features } from '@/lib/content';
import {
  productPageCopy,
  type ProductSubfeature,
} from '@/lib/product-page-copy';
import './presentation-feature.css';

const companionIcons: Record<ProductSubfeature['icon'], LucideIcon> = {
  'file-question': FileQuestion,
  sliders: SlidersHorizontal,
  network: Network,
  pencil: PencilLine,
  activity: Activity,
  search: Search,
};

export function PresentationFeatureVideo({
  slug,
  printMode = false,
}: {
  slug: string;
  printMode?: boolean;
}) {
  const feature = features.find((item) => item.slug === slug);
  if (!feature) return null;

  return (
    <div className="pm-video-slide">
      <header>
        <div>
          <p className="pm-eyebrow">ATHENA {feature.name} · 영상</p>
          <h2>{feature.tagline}</h2>
        </div>
        <p>{feature.description}</p>
      </header>
      <FeatureVideo slug={slug} presentation print={printMode} />
    </div>
  );
}

export function PresentationFeatureCapability({
  slug,
  capabilityIndex,
}: {
  slug: string;
  capabilityIndex: number;
}) {
  const feature = features.find((item) => item.slug === slug);
  const copy = productPageCopy[slug];
  const capability = copy?.mainFeatures[capabilityIndex];
  if (!feature || !copy || !capability) return null;

  return (
    <article className="pm-capability-slide">
      <header>
        <p className="pm-eyebrow">ATHENA {feature.name} · 주요 기능</p>
        <h2>{capability.title}</h2>
        <p>{capability.description}</p>
      </header>
      <figure>
        <Image
          src={capability.image}
          alt={capability.imageAlt}
          width={1536}
          height={1024}
          sizes="(max-width: 900px) 100vw, 1500px"
          unoptimized
        />
      </figure>
    </article>
  );
}

export function PresentationFeatureCompanions({ slug }: { slug: string }) {
  const feature = features.find((item) => item.slug === slug);
  const copy = productPageCopy[slug];
  if (!feature || !copy?.subfeatures?.length) return null;

  return (
    <article className="pm-companions-slide">
      <header>
        <p className="pm-eyebrow">ATHENA {feature.name}</p>
        <h2>함께 쓰는 기능</h2>
        <p>{copy.intro}</p>
      </header>
      <div>
        {copy.subfeatures.map((companion) => {
          const Icon = companionIcons[companion.icon];
          return (
            <section key={companion.title}>
              <Icon aria-hidden="true" size={36} strokeWidth={1.5} />
              <h3>{companion.title}</h3>
              <p>{companion.description}</p>
            </section>
          );
        })}
      </div>
    </article>
  );
}
