<p align="center">
  <a href="https://athena-homepage.athena-jcahn.workers.dev/">
    <img src="https://athena-homepage.athena-jcahn.workers.dev/brand/athena.png" alt="ATHENA" width="220">
  </a>
</p>

<h1 align="center">ATHENA</h1>

<p align="center">
  <strong>투자의 시야를 가리던 안개를 걷어내다.</strong><br>
  정보 너머의 맥락이 보이도록.
</p>

<p align="center">
  <a href="https://athena-homepage.athena-jcahn.workers.dev/">공식 사이트</a>
  ·
  <a href="https://athena-homepage.athena-jcahn.workers.dev/tech">기술 문서</a>
  ·
  <a href="https://github.com/ANNJUNGCHAN/DAOU.Athena/releases">릴리스</a>
</p>

ATHENA는 대화, 차트, 투자 기록, 외부 도구와 전략 검증을 하나의 작업 공간에 연결하는 Windows용 AI 투자 워크스페이스입니다. 질문에 필요한 자료를 Canvas에 펼치고, 사용자가 근거와 실행 조건을 확인한 뒤 다음 단계로 이어갈 수 있게 구성했습니다.

개발 범위는 **투자 분석·알림·전략 작성·백테스트·결과 확인과 모의투자 계좌 주문**입니다. 모의투자 계좌 주문은 사용자가 주문 티켓에서 내용을 확인하고 직접 실행합니다. 실계좌 주문과 자동매매 배포는 제공하지 않습니다. 백테스트의 매수·매도 신호와 모의 체결은 과거 데이터에 대한 시뮬레이션으로 지원합니다.

<p align="center">
  <img src="https://athena-homepage.athena-jcahn.workers.dev/screens/agora.png" alt="ATHENA Agora 대화형 투자 작업 공간" width="100%">
</p>

## 여섯 가지 작업 공간

| 기능 | 역할 |
| --- | --- |
| **Agora · 아고라** | 한 문장으로 질문하고 필요한 차트와 정보를 대화 옆 Canvas에서 살펴봅니다. |
| **Metis · 메티스** | 대화와 투자 기록의 관계를 출처와 함께 지식 그래프로 확인합니다. |
| **Aegis · 아이기스** | 반복해서 확인할 조건과 일정을 검토하고 승인해 알림과 실행 이력으로 관리합니다. |
| **Ergane · 에르가네** | 외부 도구를 등록하고 사용할 기능과 권한을 확인해 투자 환경에 연결합니다. |
| **Pallas · 팔라스** | 투자 아이디어를 기법으로 구체화하고 설정과 가정을 확인한 뒤 과거 데이터로 검증합니다. |
| **Glaux · 글로우** | 알림과 작은 대화 창에서 투자 자료를 확인하고 분석 대화를 이어갑니다. |

<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://athena-homepage.athena-jcahn.workers.dev/screens/metis.png" alt="ATHENA Metis 지식 그래프 화면" width="100%"><br>
      <strong>Metis</strong> · 관계와 근거를 함께 보는 지식 그래프
    </td>
    <td width="50%" align="center">
      <img src="https://athena-homepage.athena-jcahn.workers.dev/screens/aegis.png" alt="ATHENA Aegis 알림과 루틴 화면" width="100%"><br>
      <strong>Aegis</strong> · 조건과 일정을 관리하는 루틴
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="https://athena-homepage.athena-jcahn.workers.dev/screens/ergane.png" alt="ATHENA Ergane 외부 도구 연결 화면" width="100%"><br>
      <strong>Ergane</strong> · 외부 도구와 권한 관리
    </td>
    <td width="50%" align="center">
      <img src="https://athena-homepage.athena-jcahn.workers.dev/screens/pallas.png" alt="ATHENA Pallas 투자 전략 검증 화면" width="100%"><br>
      <strong>Pallas</strong> · 기법 작성과 백테스트
    </td>
  </tr>
</table>

<p align="center">
  <img src="https://athena-homepage.athena-jcahn.workers.dev/media/glaux-studio.png" alt="ATHENA Glaux 데스크톱 파트너" width="78%"><br>
  <strong>Glaux</strong> · 작업 곁에서 알림과 대화를 이어가는 데스크톱 파트너
</p>

## Windows에 설치

[ATHENA v0.1.5 설치 파일 다운로드](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases/download/v0.1.5/Athena-Setup-0.1.5-x64.exe)

Windows x64용 설치 프로그램은 Electron 앱과 로컬 Python 백엔드를 포함합니다. 설치 후 ATHENA를 실행하고 사용할 모델 공급자에 로그인하세요. 키움 데이터 조회에는 별도의 API 자격 증명 연결이 필요합니다.

현재 설치 파일은 코드 서명되지 않았습니다. 릴리스에 첨부한 SHA-256 체크섬으로 다운로드 파일을 확인할 수 있습니다.

## 개발 환경에서 실행

현재 공개 저장소는 Windows 앱 실행과 재빌드에 필요한 소스를 제공합니다. 실행에는 **Node.js와 npm**, **Python 3.11 이상**, **uv**가 필요합니다.

```powershell
git clone https://github.com/ANNJUNGCHAN/DAOU.Athena.git
Set-Location DAOU.Athena

npm ci --prefix app
node app/node_modules/electron/install.js

Push-Location backend
uv sync
Pop-Location

npm --prefix app start
```

`npm --prefix app start`는 Electron 앱과 `backend/.venv/Scripts/python.exe`의 로컬 백엔드를 함께 시작합니다. 키움 시세·차트·계좌 자료 조회와 백테스트용 시세 수집에는 발급받은 API 자격 증명 연결이 필요합니다. 주문은 모의투자 계좌에서만, 백엔드의 주문 API 설정과 설정 › 계좌의 주문 API 허용을 거친 뒤 주문 티켓에서 사용자가 직접 확인해 실행합니다. 실계좌 주문과 자동매매는 제공하지 않습니다.

> 이 공개 저장소는 실행·재빌드 범위에 맞춰 구성되어 있습니다. 내부 검증 스크립트와 원본 작업 기록은 기본 배포 대상에 포함하지 않으며, 공개 검토한 학습 요약과 출처 기록만 선별해 보관합니다.

### 기본 앱의 LAYA 런타임과 모의 백테스트

0.1.5부터 Windows 설치 파일에는 Athena용 LAYA v018 모델과 CPU 실행 환경이 포함됩니다. 앱이 포함된 모델을 자동으로 찾아 실행하므로 별도 Python 설치, 모델 다운로드, 토큰 입력이 필요하지 않습니다. 모델을 읽는 동안에는 기존 대체 경로를 사용합니다. 명시한 `ATHENA_LAYA_*` 런타임 설정은 기본 번들보다 우선합니다. 인증 토큰은 앱 실행마다 메모리에서 생성하며, 로그는 사용자 홈의 `.athena/logs/laya`에 저장합니다.

모델과 빌드용 CPU wheel은 GitHub Release의 `Athena-LAYA-v018-cpu-bundle.zip`으로 배포합니다. Git checkout에는 큰 모델이 들어 있지 않습니다. 소스에서 실행하려면 이 번들의 런타임 파일을 `backend/laya-runtime`에 준비하고 동일한 Python 환경에 고정된 CPU 의존성을 설치해야 합니다. 번들 규격과 검증 명령은 [LAYA 배포 안내](scripts/release/LAYA.md)를 참고하세요. 과거 후보 선택 실험의 `ATHENA_LAYA_ENABLED`·`ATHENA_LAYA_BASE_URL` 설정은 사용하지 않습니다.

앞으로 모델·요청받은 학습 상태는 Release에, 공개 가능한 작은 학습 기록은 Git에 연결해 보관합니다. 분할 파일 복원과 공개 검증 기준은 [학습 산출물 보존·공개 지침](scripts/release/TRAINING-ARTIFACTS.md)을 따릅니다.

포함한 모델은 현재 사용 중인 `v018-block002-cpu-force-choice-20261006`입니다. 이 정책은 confidence threshold가 0이며 `defer`를 제외한 최고 점수 선택을 사용합니다. 이번 배포는 설치·CPU 실행을 검증하며, 이 정책의 정확도를 새로 보증하지 않습니다. LAYA는 요청 판단을 보조하며 기존 권한 검사와 주문 확인 절차를 대체하지 않습니다. 모델·토크나이저의 라이선스와 이용조건은 번들 `notices` 폴더 및 설치 화면에서 확인할 수 있습니다.

자연어 전략 모의 백테스트는 사용자가 별도 화면에서 명시적으로 시작하는 실험 기능으로 보존했습니다. 이 기능은 기존 로컬 LAYA 서버(기본 `http://127.0.0.1:8768`)를 사용하며, 일반 요청의 CPU 배포 런타임과 별개입니다. 소스 병합이 실제 모델의 판단 정확도나 설치 파일 포함 여부를 보증하지 않습니다. [통합 범위와 품질 한계](backend/ref/laya-experiments.md)를 확인하세요.

<details>
<summary><strong>버전과 릴리스 운영 안내</strong></summary>

버전은 [GitHub Releases](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases)가 기록입니다.
태그 `vX.Y.Z`를 `main`의 커밋에 달면 CI가 같은 이름의 Release를 만듭니다.

### 버전 규칙

- 트리 안 버전은 `app/package.json`, `app/package-lock.json`, `backend/pyproject.toml`, `backend/uv.lock`이 같습니다.
- Git 태그는 `v` + 그 버전입니다. 예: `0.1.0-beta.1` → `v0.1.0-beta.1`
- 하이픈이 있는 버전(`-beta.1` 등)은 GitHub prerelease이고 Latest가 되지 않습니다.

트리 안 현재 값은 `app/package.json`의 `version`입니다.

### 릴리스 자르기

깨끗한 `main`에서 버전을 맞춘 뒤 커밋하고 태그를 푸시합니다. origin/main 푸시 전에 `powershell -File scripts/security/eval-security-gates.ps1`가 `ALL_GATES_PASS`여야 합니다.

```powershell
node scripts/release/set-version.mjs 0.1.0
node scripts/release/check-version.mjs
git add app/package.json app/package-lock.json backend/pyproject.toml backend/uv.lock
git commit -m "chore(release): v0.1.0"
git tag -a v0.1.0 -m "v0.1.0"
git push origin main
git push origin v0.1.0
```

Windows 설치 파일은 CI가 만들지 않습니다. 로컬에서 같은 버전으로 빌드한 뒤 선택적으로 올립니다. `-Version`을 생략하면 `app/package.json` 버전을 씁니다.

0.1.3 소스부터 설치 파일에는 MCP 서버 실행용 Node.js·npm/npx와 uv/uvx도 포함합니다. 아테나는 포함된 실행 환경을 우선 사용하므로, 시작 메뉴에서 실행했을 때 터미널 전용 PATH 설정이 없어도 MCP를 시작할 수 있습니다. 사용자 PATH나 기존 MCP 자격 증명·허용 설정을 변경하지 않습니다. MCP 패키지를 처음 받는 데에는 인터넷 연결이 필요합니다. 위의 공개 다운로드 링크는 실제 배포된 버전을 가리키며, 소스 버전 변경만으로 설치 파일이 갱신되지는 않습니다.

MCP 번들만 검증하려면 `scripts/release/stage-windows-mcp-runtimes.ps1`에 새 `-Destination`과 `-DownloadDirectory`를 지정합니다. 이후 `backend` 폴더에서 `.venv/Scripts/python.exe -m verification.verify_mcp_bundled_runtime <번들 경로>`를 실행하면 시스템 Node·uv 경로 없이 MCP 초기화·도구 조회·호출을 검사합니다. `--python <설치본 python.exe 경로>`로 설치본 Python을 지정할 수 있습니다. 검증은 별도 임시 캐시를 사용하며 등록된 사용자 MCP 서버나 자격 증명을 사용하지 않습니다.

```powershell
pwsh -NoProfile -File scripts/build-windows-installer.ps1 -LayaBundle C:/build-inputs/Athena-LAYA-v018-cpu-bundle
gh release upload v0.1.0 .omc/artifacts/windows-installer/0.1.0/dist/Athena-Setup-0.1.0-x64.exe
```

</details>
