import {
  CanonicalPresentation,
  type CanonicalSlideAsset,
} from '@/components/canonical-presentation';
import slideManifest from '@/public/presentation/slides/manifest.json';

export default function PresentationPage() {
  return (
    <main>
      <CanonicalPresentation
        sourceSha256={slideManifest.source.sha256}
        slides={slideManifest.slides as CanonicalSlideAsset[]}
      />
    </main>
  );
}
