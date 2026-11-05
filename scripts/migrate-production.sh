#!/usr/bin/env sh
set -eu

docker compose -f docker-compose.production.yml --profile release build migrate
docker compose -f docker-compose.production.yml --profile release run --rm migrate
