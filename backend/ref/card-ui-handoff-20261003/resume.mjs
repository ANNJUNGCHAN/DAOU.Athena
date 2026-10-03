import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const planSource = path.join(directory, 'PLAN.md');
const planTarget = path.join(root, '.omc/plans/card-ui-maximize-resize-verification-20261002.md');
const goal = 'Paper 101개 편집 가능한 도면을 보존하고, 범위 내 94개 카드 상태를 최소 입력으로 실제 앱에서 호출해 같은 카드의 최대화→축소→재최대화, 하단·마지막 열·탭·펼침을 검증한다. UI 결함을 최소 수정하고 독립 검토 및 실제 앱 재검증 후 질문지·도면을 갱신한다. LAYA 분리와 실거래 제외를 유지하며 필수 검사·보안 게이트·최종 검토 후 UI 브랜치를 push한다.';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Git checkout를 먼저 준비하세요.');
if (!fs.existsSync(planSource)) throw new Error('저장소의 PLAN.md가 없습니다.');
let planState;
if (!fs.existsSync(planTarget)) {
  fs.mkdirSync(path.dirname(planTarget), { recursive: true });
  fs.copyFileSync(planSource, planTarget, fs.constants.COPYFILE_EXCL);
  planState = 'restored';
} else {
  planState = hash(fs.readFileSync(planSource)) === hash(fs.readFileSync(planTarget)) ? 'already-current' : 'existing-local-plan-preserved';
}
const questionnaire = JSON.parse(fs.readFileSync(path.join(root, 'backend/ref/card-ui-questionnaire.json'), 'utf8'));
if (questionnaire.scope.template_total !== 101 || questionnaire.scope.in_scope_templates !== 94) throw new Error('원래 카드 범위와 다른 질문지입니다.');
const output = {
  branch: git.stdout.trim(),
  plan: path.relative(root, planTarget).replaceAll('\\', '/'),
  canonicalPlan: 'backend/ref/card-ui-handoff-20261003/PLAN.md',
  planState,
  goal,
  scope: { editablePaperStates: 101, realAppStates: 94, excludedOrderStates: 7 },
  nextPrompt: 'AGENTS.md와 backend/ref/card-ui-handoff-20261003/README.md, PLAN.md를 읽고 카드 UI 계획을 이어서 실행해. 현재 Git 상태·소스·의존성부터 확인하고, 인수인계의 실패와 미검증 항목을 유지한 채 작성과 독립 검토를 분리해서 진행해. 전체 94개 실제 검증 전 완료로 표시하지 마.',
  startsAgent: false,
  startsApp: false,
  readsUserProfile: false,
};
console.log(JSON.stringify(output, null, 2));
