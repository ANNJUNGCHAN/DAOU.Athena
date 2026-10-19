export type AgoraFiling = {
  title: string;
  type: string;
  date: string;
  dateLabel: string;
  summary: string;
  sourceUrl: string;
  excerptHeading: string;
  excerpt: string[];
  highlights: string;
  readerFacts?: { label: string; value: string }[];
};

// Public originals checked 2026-09-10. This is a fixed research snapshot,
// not a live, exhaustive filing feed. Excerpts stay separate from analysis.
export const agoraFilings: { asOf: string; filings: AgoraFiling[]; analysis: string[] } = {
  asOf: '2026-09-10 확인',
  filings: [
    {
      title: '반기보고서 (제58기)',
      type: '정기공시',
      date: '2026-08-14',
      dateLabel: '문서 제출일',
      summary: '상반기 사업·재무 현황',
      sourceUrl: 'https://images.samsung.com/kdp/ir/business-report/2026_2Q_Interim_Business_Report_vF_kr.pdf',
      excerptHeading: 'II. 사업의 내용 · 주요 제품 및 서비스',
      excerpt: ['※ 각 부문별 매출액은 부문 등 간 내부거래를 포함하고 있습니다.'],
      highlights: '보고기간 2026.01.01~06.30 · 문서 23쪽 / PDF 26쪽',
      readerFacts: [
        { label: '보고서', value: '반기보고서 · 제58기' },
        { label: '보고기간', value: '2026년 1월 1일 ~ 6월 30일' },
        { label: '제출일', value: '2026년 8월 14일' },
      ],
    },
    {
      title: '자기주식 취득 결정¹',
      type: 'IR 공시',
      date: '2026-08-21',
      dateLabel: 'IR 게시일',
      summary: '임직원 주식보상 목적의 취득 계획',
      sourceUrl: 'https://www.samsung.com/global/ir/reports-disclosures/public-disclosure-view.84756/',
      excerptHeading: '5. Purpose of repurchase',
      excerpt: ['To facilitate employee stock-based compensation'],
      highlights: '공식 영문 공시 · 취득 완료 공시가 아닌 계획',
    },
    {
      title: '2026년 주주환원 예상 규모·실행 계획¹',
      type: 'IR 공시',
      date: '2026-08-21',
      dateLabel: 'IR 게시일',
      summary: '예상 환원 규모와 향후 결정 일정',
      sourceUrl: 'https://www.samsung.com/global/ir/reports-disclosures/public-disclosure-view.84755/',
      excerptHeading: '1. Details of information',
      excerpt: ['Expected Amount and Implementation Plan for 2026 Shareholder Returns'],
      highlights: '공식 영문 공시 · 예상 금액은 확정 지급액이 아님',
    },
  ],
  analysis: [
    '공식 IR에서 확인한 세 건을 표로 정리했어요. 반기보고서의 과거 실적과 8월 21일 공시의 향후 계획을 구분해 읽어야 해요.',
    '자기주식 취득 목적은 임직원 주식보상이에요. 소각을 위한 매입이나 취득 완료로 해석하면 안 돼요.',
    '주주환원 공시는 예상 규모와 실행 계획이에요. 확정 지급액으로 보지 않고 이후 결정과 현금흐름을 함께 확인해야 해요.',
  ],
};
