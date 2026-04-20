# Development UI Fixtures

`development` 전용 `.pen` UI 검증 데이터를 기존 API 위에 그대로 올리기 위한 시드 문서다.

## 원칙

- production 에서는 동작하지 않는다.
- mock endpoint 를 추가하지 않고 기존 로그인/API 계약을 우선 사용한다.
- 클라이언트는 기존 auth + live endpoint 를 거의 그대로 호출하면 된다.
- 한 번의 dev seed 로 여러 검증 시나리오 계정을 동시에 만든다.

## 실행

```bash
npm run prisma:seed:dev
```

기본 공유 비밀번호:

```text
DevSeed1234
```

다른 비밀번호를 쓰고 싶으면 `DEV_SEED_PASSWORD` 를 지정한다.

```bash
DEV_SEED_PASSWORD=MyDevSeed1234 npm run prisma:seed:dev
```

## 검증용 계정

| scenario | email | 용도 |
| --- | --- | --- |
| `default_populated_user` | `dev.default@example.com` | 홈/그룹/모집/전적/알림/파워를 한 번에 확인하는 기본 계정 |
| `empty_user` | `dev.empty@example.com` | 그룹/전적/Riot/알림이 비어 있는 상태 확인 |
| `leader_user` | `dev.leader@example.com` | 비공개 그룹 리더 권한, 지원자 조회 확인 |
| `member_user` | `dev.member@example.com` | 일반 멤버 관점 확인 |
| `recruiting_heavy_user` | `dev.recruiter@example.com` | 공개 모집글 다량 상태 확인 |
| `profile_connected_user` | `dev.profile@example.com` | Riot 연결 + power profile 중심 확인 |

## 고정 fixture id

그룹:

- `dev_group_public_clash`
- `dev_group_private_night`
- `dev_group_team_lab`

모집글:

- `dev_post_public_mid`
- `dev_post_public_scrim`
- `dev_post_public_closed`
- `dev_post_private_support`
- `dev_post_private_closed`

매치:

- `dev_match_public_upcoming`
- `dev_match_private_balanced`
- `dev_match_team_lab_upcoming`
- `dev_match_public_confirmed`
- `dev_match_private_closed`
- `dev_match_public_pending`

결과:

- `dev_result_public_confirmed`
- `dev_result_private_closed`
- `dev_result_public_pending`

## 화면별 권장 확인 경로

홈:

- `POST /auth/login/email`
- `GET /users/me`
- `GET /users/:userId/power-profile`
- `GET /users/:userId/stats`
- `GET /notifications`
- `GET /groups/:groupId/matches/recent`

그룹:

- `GET /groups/public`
- `GET /groups/:groupId`
- `GET /groups/:groupId/members`
- `GET /groups/:groupId/leaderboard`
- `GET /groups/:groupId/matches/recent`

모집:

- `GET /recruiting-posts/public`
- `GET /recruiting-posts?groupId=:groupId`
- `GET /recruiting-posts/:postId`
- `GET /recruiting-posts/:postId/applicants`

프로필/파워:

- `GET /riot-accounts`
- `GET /users/:userId/power-profile`
- `GET /users/:userId/stats`
- `GET /users/:userId/inhouse-history`

결과/전적:

- `GET /matches/:matchId/summary`
- `GET /matches/:matchId/results`

## smoke 검증

로컬 서버가 떠 있는 상태에서 주요 populated/empty 흐름을 점검한다.

```bash
npm run smoke:dev-fixtures
```

기본 검증 대상:

- `default_populated_user`
- `leader_user`
- `empty_user`

특정 시나리오만 돌리려면 뒤에 이름을 붙인다.

```bash
npm run smoke:dev-fixtures -- default_populated_user empty_user
```
