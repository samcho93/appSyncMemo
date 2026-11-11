# appSyncMemo

[memoSync](https://github.com/samcho93/memoSync)(Windows 포스트잇 메모 앱)의 **모바일 웹앱(PWA)** 입니다.
데스크탑이 쓰는 **Google Drive 폴더의 `{uuid}.json` 파일을 그대로 읽고 써서** 서버 없이 같은 메모를 봅니다.
데스크탑 앱은 수정할 필요가 없습니다.

## 기능

- 메모 목록(검색), 작성·수정·삭제, 색상 6종 (입력 후 약 0.5초 뒤 자동 저장)
- 달력: 메모에 적은 날짜(`3/5 치과`, `2027년 3월 5일 회의` 등)를 데스크탑과 같은 규칙으로 일정 표시
- 오프라인 작성 (IndexedDB 캐시) → 연결되면 자동 동기화 (편집 후 2.5초, 60초 주기, 앱 복귀·온라인 전환 시)
- 홈 화면에 설치해 앱처럼 사용

지원하지 않는 것: 파일 첨부 공유, 창 위치·투명도·글꼴 편집 (데스크탑 전용 필드는 모바일에서 고쳐도 그대로 보존됩니다)

## 데스크탑과 호환되는 방식

| 항목 | 동작 |
| --- | --- |
| 파일 형식 | 데스크탑과 같은 키 순서·들여쓰기로 직렬화 (`js/record.js`) |
| 충돌 | `updatedAt`이 큰 쪽이 이김, 같으면 `deviceId`로 결정 (`js/merge.js`, 데스크탑과 동일) |
| 삭제 | 파일을 지우지 않고 `deleted: true` 표시 → 30일 뒤 데스크탑이 정리 |
| 폴더가 통째로 비었을 때 | 삭제로 보지 않고 다시 올림 |
| 충돌 사본 파일 (`{uuid} (…).json`) | 모바일은 건드리지 않음 (데스크탑이 병합) |

## 설정 방법

### 1. 배포 (GitHub Pages)

저장소 **Settings → Pages → Build and deployment → Deploy from branch → `main` / `/ (root)`**.
주소는 `https://samcho93.github.io/appSyncMemo/` 형태입니다. (Private 저장소의 Pages는 유료 요금제에서만 가능합니다. 코드에 비밀 값이 없으므로 Public으로 둬도 안전합니다.)

### 2. Google OAuth 클라이언트 ID 만들기 (한 번만)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들고 **Google Drive API**를 사용 설정
2. **OAuth 동의 화면**: 사용자 유형 *외부*, 게시 상태 *테스트*, **테스트 사용자에 본인 Google 계정 추가**
3. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**, *승인된 JavaScript 원본*에 `https://samcho93.github.io` 추가
4. 발급된 클라이언트 ID(`…apps.googleusercontent.com`) 복사

클라이언트 시크릿은 쓰지 않습니다. 클라이언트 ID는 앱 설정 화면에 입력하며 기기 안(localStorage)에만 저장됩니다.

### 3. 앱에서 연결

1. 폰 브라우저에서 앱 주소를 열고 **설정**에 클라이언트 ID 입력 → **저장하고 연결** (Google 로그인, "확인되지 않은 앱" 경고는 *고급 → 이동*)
2. **폴더 찾기**에서 데스크탑 memoSync가 쓰는 Drive 폴더(예: `memoSync`) 선택
3. 브라우저 메뉴의 **홈 화면에 추가**로 설치

## 알아둘 점

- 데스크탑 폴더의 파일을 읽으려면 전체 Drive 범위(`drive`)가 필요합니다. (`drive.file`은 이 앱이 만든 파일만 보입니다.) 테스트 모드의 앱이라 본인 계정만 쓸 수 있습니다.
- Google 토큰은 약 1시간마다 만료되며, 앱이 조용히 갱신을 시도합니다. 실패하면 상단에 **다시 연결** 버튼이 나옵니다.
- 데스크탑↔모바일은 Google Drive for desktop이 PC 쪽 파일을 올리는 시간만큼 지연됩니다. 모바일에서 올린 변경이 PC에 반영되는 시간도 마찬가지입니다.
- 메모 단위 last-write-wins라서 두 기기에서 같은 메모를 동시에 고치면 나중에 저장한 쪽이 남습니다.
- 메모는 Drive에 평문 JSON으로 저장되므로 민감한 정보는 적지 마세요.

## 개발

정적 파일뿐이라 빌드가 필요 없습니다. 모듈 구성:

```
js/record.js   레코드 검증·직렬화 (데스크탑 main/sync/record.js와 동일 규칙)
js/merge.js    last-write-wins 승자 결정
js/schedule.js 일정 파서 (데스크탑 main/schedule.js와 동일 규칙)
js/sync.js     동기화 엔진 (Drive 어댑터·저장소를 주입받아 테스트 가능)
js/drive.js    Google Drive v3 REST 어댑터
js/auth.js     Google Identity Services 토큰 방식 로그인
js/store.js    IndexedDB 캐시
js/app.js      화면(목록·편집·달력·설정)
sw.js          앱 껍데기 오프라인 캐시
```

```bash
npm test          # 동기화 엔진(가짜 Drive)과 파서·직렬화 테스트
npm run serve     # http://localhost:8080 에서 확인
```
