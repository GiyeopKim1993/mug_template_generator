/* ============================================================
   MT_CONFIG — 운영 설정 (이 파일이 곧 관리 페이지의 저장 대상)
   편집: Codespace에서  node admin/server.js  → 브라우저 UI로 수정
   직접 고칠 때는 포맷(JSON)을 유지하세요.
   version을 올리면 광고 쿨다운·해제 상태가 재무장(reset)됩니다.
   ============================================================ */
window.MT_CONFIG = {
  "version": 1,
  "support": {
    "toss": "",
    "kakao": "",
    "bmc": ""
  },
  "ad": {
    "enabled": false,
    "html": ""
  },
  "triggers": {
    "export": {
      "on": true,
      "every": 3
    },
    "designs": {
      "on": true,
      "min": 5
    }
  },
  "adCloseMutes": true,
  "donorHashes": []
};
