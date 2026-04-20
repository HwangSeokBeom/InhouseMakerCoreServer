#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="main"
DEPLOY_ENV="production"
ENV_FILE=".env.production"
PM2_APP_NAME="inhouse-maker-server-production"

log() {
  printf '[deploy][%s] %s\n' "${DEPLOY_ENV}" "$1"
}

fail() {
  printf '[deploy][%s][error] %s\n' "${DEPLOY_ENV}" "$1" >&2
  exit 1
}

on_error() {
  printf '[deploy][%s][error] Failed at line %s while running: %s\n' "${DEPLOY_ENV}" "$1" "$2" >&2
}

trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."
}

guard_branch() {
  if [[ -n "${GITHUB_REF_NAME:-}" && "${GITHUB_REF_NAME}" != "${TARGET_BRANCH}" ]]; then
    fail "This script only allows ${TARGET_BRANCH} deployments. Received ${GITHUB_REF_NAME}."
  fi
}

load_environment() {
  [[ -f "${ENV_FILE}" ]] || fail "Missing environment file: ${ENV_FILE}"

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  export NODE_ENV=production
  export APP_ENV="${DEPLOY_ENV}"
  export PORT="${PORT:-3000}"
  export HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://127.0.0.1:${PORT}/health/ready}"
  export HEALTH_CHECK_MAX_ATTEMPTS="${HEALTH_CHECK_MAX_ATTEMPTS:-20}"
  export HEALTH_CHECK_DELAY_SECONDS="${HEALTH_CHECK_DELAY_SECONDS:-3}"
}

sync_repository() {
  local repo_source="${DEPLOY_REPOSITORY_URL:-origin}"

  log "Fetching latest code from ${TARGET_BRANCH}."
  git fetch "${repo_source}" "${TARGET_BRANCH}"

  log "Checking out ${TARGET_BRANCH}."
  git checkout "${TARGET_BRANCH}"

  if [[ "$(git rev-parse --abbrev-ref HEAD)" != "${TARGET_BRANCH}" ]]; then
    fail "Git checkout guard failed. Current branch is $(git rev-parse --abbrev-ref HEAD)."
  fi

  log "Pulling latest ${TARGET_BRANCH} changes."
  git pull --ff-only "${repo_source}" "${TARGET_BRANCH}"
}

install_dependencies() {
  if [[ -f "package-lock.json" ]]; then
    log "Installing dependencies with npm ci."
    npm ci
  else
    log "package-lock.json not found. Falling back to npm install."
    npm install
  fi
}

generate_prisma_client() {
  log "Generating Prisma client."
  npx prisma generate
}

apply_migrations() {
  log "Applying Prisma migrations."
  npx prisma migrate deploy
}

build_application() {
  log "Building application."
  npm run build
}

reload_pm2() {
  log "Reloading PM2 application ${PM2_APP_NAME}."

  if pm2 describe "${PM2_APP_NAME}" >/dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --only "${PM2_APP_NAME}" --update-env
  else
    log "PM2 application ${PM2_APP_NAME} does not exist yet. Starting it."
    pm2 start ecosystem.config.cjs --only "${PM2_APP_NAME}" --update-env
  fi

  pm2 save
  pm2 status "${PM2_APP_NAME}"
}

run_health_check() {
  local attempt
  local response_file

  response_file="$(mktemp)"

  log "Running health check against ${HEALTH_CHECK_URL}."

  for attempt in $(seq 1 "${HEALTH_CHECK_MAX_ATTEMPTS}"); do
    if curl --fail --silent --show-error "${HEALTH_CHECK_URL}" > "${response_file}"; then
      log "Health check succeeded on attempt ${attempt}."
      cat "${response_file}"
      rm -f "${response_file}"
      return 0
    fi

    log "Health check attempt ${attempt}/${HEALTH_CHECK_MAX_ATTEMPTS} failed. Retrying in ${HEALTH_CHECK_DELAY_SECONDS}s."
    sleep "${HEALTH_CHECK_DELAY_SECONDS}"
  done

  log "Health check failed. Printing PM2 diagnostics."
  rm -f "${response_file}"
  pm2 status "${PM2_APP_NAME}" || true
  pm2 logs "${PM2_APP_NAME}" --lines 100 --nostream || true
  fail "Deployment failed because ${HEALTH_CHECK_URL} never became healthy."
}

main() {
  log "Starting production deployment in $(pwd)."

  guard_branch

  require_command git
  require_command node
  require_command npm
  require_command npx
  require_command pm2
  require_command curl

  [[ -f "ecosystem.config.cjs" ]] || fail "Missing PM2 ecosystem file: ecosystem.config.cjs"

  sync_repository
  install_dependencies
  load_environment
  generate_prisma_client
  build_application
  apply_migrations
  reload_pm2
  run_health_check

  log "Production deployment completed successfully."
}

main "$@"
