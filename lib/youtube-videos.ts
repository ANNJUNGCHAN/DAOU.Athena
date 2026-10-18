export const latestDemoOriginalNames = {
  '01': '01_대화_화면-호출.mp4',
  '02': '02_대화_화면-대화.mp4',
  '03': '03_대화_자료-대화.mp4',
  '04': '04_대화_대화-주문.mp4',
  '05': '05_대화_대화-설정-모드-선택.mp4',
  '06': '06_그래프_활동-기억-탐색.mp4',
  '07': '07_그래프_지식-그래프-대화.mp4',
  '08': '08_그래프_클러스터-탐색.mp4',
  '09': '09_그래프_관계-수정-제안.mp4',
  '10': '10_그래프_맞춤-추천.mp4',
  '11': '11_알림_맞춤-알림-확인.mp4',
  '12': '12_알림_대화형-자동화.mp4',
  '13': '13_알림_통합-감시.mp4',
  '14': '14_플러그인_투자정보-연동.mp4',
  '15': '15_플러그인_도구-호출.mp4',
  '16': '16_플러그인_서비스-연동.mp4',
  '17': '17_전략_전략-작업공간-만들기.mp4',
  '18': '18_전략_바이브-코딩.mp4',
  '19': '19_전략_백테스트.mp4',
  '20': '20_전략_투자-진단.mp4',
  '21': '21_전략_조건-탐색.mp4',
  '22': '22_전략_노드-대화.mp4',
  '23': '23_글로우_미니-대화.mp4',
  '24': '24_글로우_알림에서-상세-화면-열기.mp4',
  overview: '17쪽_하나의채팅_최신앱.mp4',
} as const;

export type LatestDemoVideo = {
  key: keyof typeof latestDemoOriginalNames;
  featureSlug: 'agora' | 'metis' | 'aegis' | 'ergane' | 'pallas' | 'glaux';
  title: string;
  id: string;
  url: string;
  originalName: string;
};

const latestDemoSources = [
  { key: '01', featureSlug: 'agora', title: '화면 호출', id: 'qOpnnLEFSpQ' },
  { key: '02', featureSlug: 'agora', title: '화면 대화', id: 'gYX8LpLVc3A' },
  { key: '03', featureSlug: 'agora', title: '자료 대화', id: 'EXcMM5UrlZc' },
  { key: '04', featureSlug: 'agora', title: '모의투자 주문 티켓 확인', id: '95uzKnaMS9E' },
  { key: '05', featureSlug: 'agora', title: '설정과 모드 선택', id: 'kOoeE9dSjMs' },
  {
    key: '06',
    featureSlug: 'metis',
    title: '활동 기억 탐색',
    id: 'RMCOfqSmeH4',
  },
  {
    key: '07',
    featureSlug: 'metis',
    title: '지식 그래프 대화',
    id: 'vQe0ChCr-3s',
  },
  {
    key: '08',
    featureSlug: 'metis',
    title: '클러스터 탐색',
    id: 'RMAJ5XtVCaQ',
  },
  {
    key: '09',
    featureSlug: 'metis',
    title: '관계 수정 제안',
    id: 'XNgGGEOubAs',
  },
  { key: '10', featureSlug: 'metis', title: '맞춤 추천', id: 'rMP2_SSem0Y' },
  {
    key: '11',
    featureSlug: 'aegis',
    title: '맞춤 알림 확인',
    id: '7_z22c8EehY',
  },
  {
    key: '12',
    featureSlug: 'aegis',
    title: '대화형 자동화',
    id: 'oY9LKHI-3E0',
  },
  { key: '13', featureSlug: 'aegis', title: '통합 감시', id: 'XKfXFGH36q0' },
  {
    key: '14',
    featureSlug: 'ergane',
    title: '투자정보 연동',
    id: 'FBHRjJAArsM',
  },
  { key: '15', featureSlug: 'ergane', title: '도구 호출', id: 'ulbyYajLV30' },
  {
    key: '16',
    featureSlug: 'ergane',
    title: '서비스 연동',
    id: 'NztQkoTU1UU',
  },
  {
    key: '17',
    featureSlug: 'pallas',
    title: '전략 작업공간 만들기',
    id: 'TYnE0XG0Bas',
  },
  { key: '18', featureSlug: 'pallas', title: '바이브 코딩', id: '607NYAsaCcQ' },
  { key: '19', featureSlug: 'pallas', title: '백테스트', id: 'K7kcbz2aKHc' },
  { key: '20', featureSlug: 'pallas', title: '투자 진단', id: 'g-vkPQf-D8o' },
  { key: '21', featureSlug: 'pallas', title: '조건 탐색', id: 'Si0cXs5A81Y' },
  { key: '22', featureSlug: 'pallas', title: '노드 대화', id: 'fXI_UmOl3UA' },
  { key: '23', featureSlug: 'glaux', title: '미니 대화', id: 'CdGBk69z4YM' },
  {
    key: '24',
    featureSlug: 'glaux',
    title: '알림에서 상세 화면 열기',
    id: 'FZmPZYuAFtM',
  },
  {
    key: 'overview',
    featureSlug: 'agora',
    title: '하나의 채팅으로 이어지는 작업',
    id: 'EIh-xZG81aQ',
  },
] as const;

export const latestDemoVideos: LatestDemoVideo[] = latestDemoSources.map(
  (video) => ({
    ...video,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    originalName: latestDemoOriginalNames[video.key],
  }),
);

export const youtubeVideos = {
  agora: latestDemoVideos[0],
  metis: latestDemoVideos[6],
  aegis: latestDemoVideos[10],
  ergane: latestDemoVideos[13],
  pallas: latestDemoVideos[16],
  glaux: latestDemoVideos[22],
} as const;

export function getYoutubeVideo(slug: string): LatestDemoVideo | null {
  return slug in youtubeVideos
    ? youtubeVideos[slug as keyof typeof youtubeVideos]
    : null;
}

export function getLatestDemoVideos(slug: string): LatestDemoVideo[] {
  return latestDemoVideos.filter((video) => video.featureSlug === slug);
}
