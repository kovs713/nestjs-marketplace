#!/bin/sh
set -eu

# Run from the image's /app root; package scripts select each Drizzle config.
case "${SERVICE:?SERVICE is required}" in
  catalog-service) name=catalog ;;
  inventory-service) name=inventory ;;
  orders-service) name=orders ;;
  payment-service) name=payment ;;
  users-service) name=users ;;
  notification-service) name=notification ;;
  *) printf 'Unsupported migration service: %s\n' "$SERVICE" >&2; exit 1 ;;
esac

npm run "db:migrate:$name"
case "$SERVICE" in
  catalog-service|inventory-service|orders-service|payment-service|notification-service)
    # Public installed CLI; DATABASE_URL and default nest_outbox match the store.
    node node_modules/.bin/nest-outbox migrate
    ;;
esac
