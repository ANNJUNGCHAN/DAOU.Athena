export type PresentationSlideKind =
  | 'opening'
  | 'promise'
  | 'feature-video'
  | 'feature-capability'
  | 'feature-companions'
  | 'technology'
  | 'closing';

export type PresentationSlide = {
  id: string;
  label: string;
  duration: number;
  kind: PresentationSlideKind;
  featureSlug?: string;
  capabilityIndex?: number;
  techSlug?: string;
  techPageIndex?: number;
};

const featurePresentationOrder = [
  {
    slug: 'agora',
    name: '대화',
    capabilityDuration: 15,
    capabilities: ['화면 호출', '화면 대화', '대화주문'],
    hasCompanions: true,
  },
  {
    slug: 'metis',
    name: '그래프',
    capabilityDuration: 15,
    capabilities: ['활동 기억', '지식 대화', '맞춤 추천'],
    hasCompanions: true,
  },
  {
    slug: 'aegis',
    name: '알림',
    capabilityDuration: 20,
    capabilities: ['맞춤 알람', '대화형 자동화', '통합 감시'],
    hasCompanions: false,
  },
  {
    slug: 'ergane',
    name: '플러그인',
    capabilityDuration: 20,
    capabilities: ['투자정보 연동', '서비스 연동', '도구 호출'],
    hasCompanions: false,
  },
  {
    slug: 'pallas',
    name: '전략',
    capabilityDuration: 15,
    capabilities: ['바이브코딩', '노드 대화', '백테스트'],
    hasCompanions: true,
  },
  {
    slug: 'glaux',
    name: '알림 오브',
    capabilityDuration: 30,
    capabilities: ['미니 대화', '능동 알림'],
    hasCompanions: false,
  },
] as const;

const featureSlides = featurePresentationOrder.flatMap(
  ({ slug, name, capabilityDuration, capabilities, hasCompanions }) => {
    const slides: PresentationSlide[] = [
      {
        id: `${slug}-video`,
        label: `${name} · 영상`,
        duration: 40,
        kind: 'feature-video',
        featureSlug: slug,
      },
      ...capabilities.map((capability, capabilityIndex) => ({
        id: `${slug}-capability-${capabilityIndex + 1}`,
        label: `${name} · ${capability}`,
        duration: capabilityDuration,
        kind: 'feature-capability' as const,
        featureSlug: slug,
        capabilityIndex,
      })),
    ];

    if (hasCompanions) {
      slides.push({
        id: `${slug}-companions`,
        label: `${name} · 함께 쓰는 기능`,
        duration: capabilityDuration,
        kind: 'feature-companions',
        featureSlug: slug,
      });
    }

    return slides;
  },
);

export const presentationSlides: readonly PresentationSlide[] = [
  {
    id: 'opening',
    label: '안개를 걷어내다',
    duration: 45,
    kind: 'opening',
  },
  {
    id: 'promise',
    label: '한 문장으로 여는 투자',
    duration: 30,
    kind: 'promise',
  },
  ...featureSlides,
  {
    id: 'tech-tool-selection-1',
    label: '기술 · System 1 판단 모델 1',
    duration: 30,
    kind: 'technology',
    techSlug: '01-tool-selection',
    techPageIndex: 0,
  },
  {
    id: 'tech-tool-selection-2',
    label: '기술 · System 1 판단 모델 2',
    duration: 30,
    kind: 'technology',
    techSlug: '01-tool-selection',
    techPageIndex: 1,
  },
  {
    id: 'tech-investment-memory-1',
    label: '기술 · Graph Memory 1',
    duration: 30,
    kind: 'technology',
    techSlug: '02-investment-memory',
    techPageIndex: 0,
  },
  {
    id: 'tech-investment-memory-2',
    label: '기술 · Graph Memory 2',
    duration: 30,
    kind: 'technology',
    techSlug: '02-investment-memory',
    techPageIndex: 1,
  },
  {
    id: 'tech-graph-retrieval-1',
    label: '기술 · 그래프 검색 1',
    duration: 30,
    kind: 'technology',
    techSlug: '03-graph-retrieval',
    techPageIndex: 0,
  },
  {
    id: 'tech-graph-retrieval-2',
    label: '기술 · 군집과 숨은 연결 2',
    duration: 30,
    kind: 'technology',
    techSlug: '03-graph-retrieval',
    techPageIndex: 1,
  },
  {
    id: 'closing',
    label: '투자의 다음 장',
    duration: 45,
    kind: 'closing',
  },
];

export const PRESENTATION_DURATION = presentationSlides.reduce(
  (total, slide) => total + slide.duration,
  0,
);

export type PresentationMove = 'previous' | 'next' | 'first' | 'last';

export function movePresentationSlide(
  current: number,
  move: PresentationMove,
  count = presentationSlides.length,
) {
  if (count <= 0) return 0;
  if (move === 'first') return 0;
  if (move === 'last') return count - 1;
  if (move === 'previous') return Math.max(0, current - 1);
  return Math.min(count - 1, current + 1);
}

export function formatPresentationTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
