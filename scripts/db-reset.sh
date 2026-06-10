#!/usr/bin/env bash
set -euo pipefail

FILE="${DATABASE_URL:-}"
[ -n "$FILE" ] || {
	echo "❌ DATABASE_URL is not set (run via 'DOMIA_ENV=.env.x npm run db:reset')" >&2
	exit 1
}
case "$FILE" in
data/db/*.db) ;;
*)
	echo "❌ DATABASE_URL must be under data/db/ and end in .db (got '$FILE')" >&2
	exit 1
	;;
esac

echo "🗑  Removing $FILE"
mkdir -p "$(dirname "$FILE")"
rm -f "$FILE" "$FILE-wal" "$FILE-shm"

echo "📐 Applying schema (push)…"
drizzle-kit push --force

echo "✅ Reset complete: $FILE"
