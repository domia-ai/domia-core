#!/usr/bin/env bash
set -euo pipefail

FILE="${DATABASE_URL:-}"
[ -n "$FILE" ] || {
	echo "❌ DATABASE_URL is not set (run via 'DOMIA_ENV=.env.x npm run db:reset')" >&2
	exit 1
}
case "$FILE" in
*..*)
	echo "❌ DATABASE_URL must not contain '..' (got '$FILE')" >&2
	exit 1
	;;
esac
case "$FILE" in
*.db) ;;
*)
	echo "❌ DATABASE_URL must end in .db (got '$FILE')" >&2
	exit 1
	;;
esac

mkdir -p "$(dirname "$FILE")"
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

echo "🗑  Removing $FILE"
rm -f "$FILE" "$FILE-wal" "$FILE-shm"

echo "📐 Applying schema (push)…"
drizzle-kit push --force

echo "✅ Reset complete: $FILE"
