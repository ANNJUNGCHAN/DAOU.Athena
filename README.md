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
| **Glaux · 글로우** | 알림과 작은 대화 창을 제공하며, 주문은 종목과 수량을 확인한 뒤 사용자가 직접 실행합니다. |

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

[ATHENA v0.1.0 설치 파일 다운로드](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases/download/v0.1.0/Athena-Setup-0.1.0-x64.exe)

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

`npm --prefix app start`는 Electron 앱과 `backend/.venv/Scripts/python.exe`의 로컬 백엔드를 함께 시작합니다. 실제 키움 조회와 주문 기능은 발급받은 API 자격 증명을 연결해야 사용할 수 있으며, 주문 실행은 앱에서 사용자가 직접 확인해야 합니다.

> 이 공개 저장소는 실행·재빌드 범위에 맞춰 구성되어 있습니다. 내부 검증 스크립트와 작업 기록은 공개 배포 대상에 포함되지 않습니다.

<details>
<summary><strong>버전과 릴리스 운영 안내</strong></summary>

버전은 [GitHub Releases](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases)가 기록입니다.
태그 `vX.Y.Z`를 `main`의 커밋에 달면 CI가 같은 이름의 Release를 만듭니다.

### 버전 규칙

- 트리 안 버전은 `app/package.json`, `app/package-lock.json`, `backend/pyproject.toml`이 같습니다.
- Git 태그는 `v` + 그 버전입니다. 예: `0.1.0-beta.1` → `v0.1.0-beta.1`
- 하이픈이 있는 버전(`-beta.1` 등)은 GitHub prerelease이고 Latest가 되지 않습니다.

트리 안 현재 값은 `app/package.json`의 `version`입니다.

### 릴리스 자르기

깨끗한 `main`에서 버전을 맞춘 뒤 커밋하고 태그를 푸시합니다. origin/main 푸시 전에 `powershell -File scripts/security/eval-security-gates.ps1`가 `ALL_GATES_PASS`여야 합니다.

```powershell
node scripts/release/set-version.mjs 0.1.0
node scripts/release/check-version.mjs
git add app/package.json app/package-lock.json backend/pyproject.toml
git commit -m "chore(release): v0.1.0"
git tag -a v0.1.0 -m "v0.1.0"
git push origin main
git push origin v0.1.0
```

Windows 설치 파일은 CI가 만들지 않습니다. 로컬에서 같은 버전으로 빌드한 뒤 선택적으로 올립니다. `-Version`을 생략하면 `app/package.json` 버전을 씁니다.

```powershell
pwsh -NoProfile -File scripts/build-windows-installer.ps1
gh release upload v0.1.0 .omc/artifacts/windows-installer/0.1.0/dist/Athena-Setup-0.1.0-x64.exe
```

</details>
