# CI/CD

## 개요

이 저장소는 `dev -> main` 브랜치 전략을 기준으로 다음 흐름을 사용한다.

- PR to `dev`, `main`: GitHub Actions에서 `lint`, `build`, `test` 실행
- Push to `dev`: development EC2에 자동 배포
- Push to `main`: production EC2에 자동 배포

배포는 EC2 내부에서 다음 순서로 진행된다.

1. `git fetch`
2. `git checkout`
3. `git pull --ff-only`
4. `npm ci` 또는 `package-lock.json` 이 없으면 `npm install`
5. `prisma generate`
6. `npm run build`
7. `prisma migrate deploy`
8. `pm2 reload` 또는 첫 배포 시 `pm2 start`
9. `GET /health/ready` 확인

## 추가된 파일

- `.github/workflows/server-ci.yml`
- `.github/workflows/server-development-deploy.yml`
- `.github/workflows/server-production-deploy.yml`
- `scripts/deploy-development.sh`
- `scripts/deploy-production.sh`
- `ecosystem.config.cjs`

## Workflow 이름

- `Server CI`
- `Server Development Deploy`
- `Server Production Deploy`

## GitHub Environments 와 Secrets

GitHub repository의 `Settings -> Environments` 에서 아래 두 environment를 만든다.

- `development`
- `production`

각 environment에 동일한 이름으로 아래 secrets를 등록한다.

- `EC2_HOST`: 대상 EC2 공인 호스트 또는 IP
- `EC2_SSH_PORT`: SSH 포트. 일반적으로 `22`
- `EC2_USER`: 배포용 SSH 사용자
- `EC2_SSH_PRIVATE_KEY`: 위 사용자의 private key 전체 내용
- `DEPLOY_PATH`: 서버에 저장소를 둘 절대 경로. 예: `/srv/inhouse-maker-core-server`
- `ENV_FILE`: 멀티라인 환경 변수 파일 전체 내용

`ENV_FILE` 은 development 환경에서는 `.env.development`, production 환경에서는 `.env.production` 으로 업로드된다.

## ENV_FILE 권장 값

기본 애플리케이션 환경 변수는 `.env.example` 을 따르고, 실제 운영 파일은 `.env.development`, `.env.production` 두 개로만 관리한다. 배포용으로는 최소 아래 값들이 필요하다.

- `PORT`
- `BIND_HOST` (기본값 `127.0.0.1`; reverse proxy 없이 외부에 직접 노출할 때만 명시적으로 변경)
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `RIOT_APP_ID`
- `RIOT_API_KEY`
- `RIOT_ACCOUNT_REGION`
- `RIOT_PLATFORM_REGION`
- `RIOT_SYNC_MAX_RETRIES`
- `RIOT_SYNC_BACKOFF_MS`
- `ALLOW_SWAGGER`

선택값:

- `APPLE_AUDIENCE` (legacy fallback only)
- `GOOGLE_AUDIENCE` (legacy fallback only)
- `HEALTH_CHECK_URL`: 기본값은 `http://127.0.0.1:${PORT}/health/ready`
- `HEALTH_CHECK_MAX_ATTEMPTS`
- `HEALTH_CHECK_DELAY_SECONDS`

인증 계약 기준으로는 아래 두 값은 사실상 필수로 본다.

- `APPLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`

development 배포는 런타임 `NODE_ENV=development`, production 배포는 `NODE_ENV=production` 으로 실행된다. `APP_ENV` 를 함께 쓰는 경우에도 `development`, `production` 만 사용한다.

## PM2 프로세스 이름

- development: `inhouse-maker-server-development`
- production: `inhouse-maker-server-production`

## EC2 선행 조건

대상 EC2에는 아래가 미리 설치되어 있어야 한다.

- `git`
- `node` 와 `npm`
- `pm2`
- `curl`

예시:

```bash
npm install -g pm2
```

SSH 사용자는 `DEPLOY_PATH` 에 쓰기 권한이 있어야 한다.

## 동작 방식

### 1. CI

`server-ci.yml` 은 PR 기준으로 동작한다.

- Node.js 22 사용
- `npm ci`
- `npx prisma generate`
- `npm run lint`
- `npm run build`
- `npm test`

현재 저장소에는 별도 ESLint 설정이 없어서 `lint` 는 `typecheck` 를 호출하는 구조이고, 실제 내용은 `tsc --noEmit` 기반 타입 검증이다.

### 2. Development 배포

`server-development-deploy.yml` 은 `dev` 브랜치 push 에만 동작한다.

- dev branch guard 수행
- SSH 접속 설정
- EC2에 저장소가 없으면 초기화 후 원격 코드 fetch
- `ENV_FILE` 을 `.env.development` 으로 업로드
- `scripts/deploy-development.sh` 실행

### 3. Production 배포

`server-production-deploy.yml` 은 `main` 브랜치 push 에만 동작한다.

- branch guard 수행
- SSH 접속 설정
- EC2에 저장소가 없으면 초기화 후 원격 코드 fetch
- `ENV_FILE` 을 `.env.production` 으로 업로드
- `scripts/deploy-production.sh` 실행

## 중복 배포 방지

deploy workflow에는 environment별 `concurrency` 가 걸려 있다.

- development: `server-deploy-development`
- production: `server-deploy-production`

같은 environment의 배포는 동시에 두 개 이상 실행되지 않는다.

## 실패 로그 확인 포인트

배포 스크립트는 아래 원칙을 따른다.

- `set -euo pipefail`
- `trap` 으로 실패한 줄 번호와 명령 출력
- 단계별 로그 출력
- health check 실패 시 `pm2 status`, `pm2 logs --lines 100 --nostream` 출력

즉, 실패하면 GitHub Actions 로그에서 어느 단계에서 실패했는지 바로 확인할 수 있다.

## 롤백 한계

현재 배포 스크립트에는 자동 롤백이 없다.

- `npm run build` 실패: PM2 재기동 전이라 런타임 영향은 적지만 새 배포는 중단된다.
- `prisma migrate deploy` 실패: 코드 배포는 중단되지만 이미 적용된 migration은 자동 되돌림되지 않는다.
- `pm2 reload` 또는 health check 실패: 이전 프로세스 상태로 완전히 복구된다는 보장이 없다.

즉, production 반영 전에는 migration 내용과 health check 경로를 반드시 수동 검토해야 한다.

## 수동으로 채워야 할 값

아래 값은 코드로 자동 생성되지 않으므로 직접 정해야 한다.

- GitHub environment `development`, `production`
- 각 environment의 secrets 값
- EC2에 설치할 Node.js 버전
- EC2 SSH 사용자와 권한
- `DEPLOY_PATH`
- 배포용 환경 변수 값
- 필요 시 공통 `.env` 파일 구성 여부

## 수동 점검 예시

EC2에서 수동으로 같은 스크립트를 실행해 점검할 수 있다.

```bash
cd /srv/inhouse-maker-core-server
bash scripts/deploy-development.sh
```

```bash
cd /srv/inhouse-maker-core-server
bash scripts/deploy-production.sh
```
