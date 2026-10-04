# 구조 보고서 (STRUCTURE) — 2026-10-04 · v4.14 기준

요청: "뭐가 잘못됐는지 보고 → 개선 방향 → 적용"

## 1. 진단: 왜 버그 경로가 자꾸 생기나

| # | 안티패턴 | 증거 (현장) | 초래한 버그 |
|---|---|---|---|
| A1 | **모놀리스** `js/app.js` 2,462줄 — 에디터·렌더링·3D·PDF·배치·광고·UI 한 파일 | grep 한 번에 200+ 함수 | 어디를 고쳐도 다른 곳이 깨짐 (UI 6종 테스트가 매번 깨진 이유) |
| A2 | **전역 가변 `state` + DOM id 직접 결합** | 모든 핸들러가 `state.x=…; renderY()` 수동 전파 | 순서 의존: 값을 바꿔도 렌더를 안 부르면 다른 화면이 구식 — "가운데 안 맞음"류 잠재 버그 |
| A3 | **`applyDraft()` 재사용 = 렌더링 엔진이 상태 복원기 겸업** | `__computeImposedPages()`가 `applyDraft(d,true)`로 작업 교체 후 caller가 snapshot 복원 | 동시 빌드 race, 빌드 중 UI가 임시값으로 노출 (관측 버그 3종의 근원). quiet/락으로 **봉인만** 한 상태 = 반쪽 해결 |
| A4 | **단건/일괄 2중 파이프라인** | `exportPdf()`/`buildPdfBlob()` vs `buildImposedPdf()` 각각 구현 | "인쇄는 안 겹치는데 내보내기는 겹친다" = 한쪽만 고친 버그 구조 |
| A5 | **미리보기↔PDF 재계산 이중** | `buildImposedPrev()`와 `buildImposedPdf()`가 같은 키를 각각 캐시 | 미리보기와 실제 내보내기가 다른 결과를 낼 수 있음 |
| A6 | **데드코드 방치** | `zipStore()` 27줄, savePanel의 zip 분기 — ZIP 제거 후 방치 | 코드 독해 비용 + "zip 아직 있나?" 헷갈림 |
| A7 | **테스트가 UI 문구·id에 결합** | 테스트가 한글 카피/세그먼트 id를 직접 스냅 | 구조 개선=테스트 개보수 (매 회귀 라운드마다 수술한 직접 원인) |

## 2. 이미 적용된 것 (이 보고서와 함께)

- ✅ **A6 제거**: `zipStore` + savePanel zip 분기 완전 삭제 — `zip` 문자열 0 (user 복사 "ZIP 없음" 문구만 유지). 게이트: unit 38/38 · savepanel ✓ · r5 ALL PASS.
- ✅ R12에서 일부 완료: 단건/일괄 **저장 패널·미리보기 UI 통합**, `_imp` 캐시 1곳, quiet 래퍼, A4 단일화.

## 3. 개선 로드맵 (각 단계 = 전체 테스트 통과가 게이트)

### S3-a: `computeImposedPages` 상태 해방 (A3 근원 제거) ← 다음 작업
- 현재: 작업마다 `applyDraft`로 전역 상태를 덮고 snapshot 복원.
- 목표: **함수 인자로 드래프트를 그리는 순수 렌더** `composeDraft(d) → canvas` — 전역 상태 0회 변이.
- 흑단: `composeArtFlat`이 `state`/`layers`에 의존 → 임시 state 객체 주입 방식으로 분리.
- 게이트: r5·savepanel·paths·workbench 무변화, `_applyQuiet`/snapshot dance **삭제 가능**해짐.

### S3-b: 단일 export 서비스 (A4/A5 완결)
- `exportPdf`(단건) / `buildImposedPdf`(일괄) / `buildImposedPrev`(미리보기)를 **한 파이프라인**으로:
  `composeDrafts(drafts) → cells → [buildPdf | preview bits]`.
- 미리보기와 PDF는 같은 `pages` 캐시를 공유 (`imposedKey()` 1개).
- 게이트: 참고 PDF 3장 대비 겹침 0 검증 유지 (기하 스크립트), e2e·r5·savepanel.

### S4: 결합 해소 (A1/A2/A7)
- `js/export.js`(파이프라인) / `js/store.js`(상태+구독) 로 분리 — app.js는 UI 바인딩만.
- 핵심 테스트 자리에 `data-testid` 부착 → 한글 카피 변경이 테스트를 깨지 않음.
- 게이트: 전 회귀 통과 후 파일 분리 (script 순서 보존).

## 4. 하지 않는 것 (합의된 불변)
- `computeLayout`(단건 인쇄) 정상 경로 — 건드리지 않음 (R12 계약).
- contain/노스트레치, 가이드 비인쇄, 단건·일괄 통합 UX.
