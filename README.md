# 꿀딜 피드 (개인용)

뽐뿌게시판 RSS를 10분마다 모아 웹에서 거르고, 조건에 맞는 딜을 텔레그램으로 알려줍니다.

## 실행
```
npm start          # http://localhost:3000
npm run collect    # 수집만 1회
```
Node.js 22.5 이상 필요 (외부 패키지 없음, 내장 SQLite 사용). 데이터: `data/deals.db`

## 기능
- 검색 / 카테고리 / 쇼핑몰 / 최대 가격 필터
- 정렬: 최신 · 조회 급상승(조회수 ÷ 경과분) · 추천 · 낮은 가격
- **다나와 시세** 버튼: 누른 딜 1건만 다나와에서 검색해 최저가와 비교 (1시간 캐시)
- 텔레그램 알림 (아래 설정)

## 설정 `config.json` (첫 실행 시 자동 생성)
| 키 | 의미 |
|---|---|
| `collectMinutes` | 수집 주기(분). RSS가 최신 15건만 주므로 10분 권장 |
| `telegram.botToken` / `chatId` | 비우면 알림 끔. 환경변수 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 로도 가능 |
| `alerts.keywords` | 제목에 포함되면 알림 |
| `alerts.categories` + `maxPrice` | 해당 카테고리이면서 가격 이하이면 알림 |
| `alerts.hotViewsPerMin` / `hotRecommend` | 조회 속도·추천수가 넘으면 알림 |
| `alerts.excludeKeywords` | 포함되면 알림 제외 |

텔레그램 봇: @BotFather 에서 `/newbot` → 토큰 발급, 봇에게 아무 말 보낸 뒤
`https://api.telegram.org/bot<토큰>/getUpdates` 에서 `chat.id` 확인.

## 주의
- 개인 용도 전용. 제목·가격·링크만 저장하고 본문은 퍼오지 않습니다.
- 뽐뿌 목록 페이지는 자동 접근이 차단(403)되어 RSS만 사용합니다. RSS `hits` 값은 [추천|조회|…]로 추정해 해석합니다.
- 다나와 비교는 상품명 검색 결과 1순위 기준이라 구성(용량·수량·모델)이 다를 수 있습니다. 판정은 참고용.
- 다나와는 버튼 클릭 시에만 조회합니다 (대량 수집 금지 조건 준수).
