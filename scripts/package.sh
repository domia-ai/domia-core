#!/usr/bin/env bash
# Build a deployable tarball: compiled build/ + templates + scripts + runtime manifest.
# Usage: scripts/package.sh [out-dir]   (PACKAGE_SKIP_BUILD=1 reuses an existing build/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
	COMMIT="${COMMIT}-dirty"
fi
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NAME="domia-core-${VERSION}+${COMMIT}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [ -z "${PACKAGE_SKIP_BUILD:-}" ] || [ ! -f build/index.js ]; then
	echo "🏗️  building..."
	npm run build >/dev/null
fi

CONTENTS=(
	build
	templates
	scripts
	proto
	drizzle.config.ts
	src/db/schema.ts
	src/db/constants.ts
	src/db/json-types.ts
	package.json
	package-lock.json
	.env.example
	makefile
	docker-compose.yml
	config/mqtt/mosquitto.conf
	config/mqtt/conf.d
	config/mqtt/acl.example
	docs/DEPLOY.md
	README.md
	LICENSE
)

mkdir -p "$STAGE/$NAME"
for item in "${CONTENTS[@]}"; do
	[ -e "$item" ] || { echo "❌ missing $item"; exit 1; }
	mkdir -p "$STAGE/$NAME/$(dirname "$item")"
	cp -R "$item" "$STAGE/$NAME/$item"
done

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
	else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

{
	echo "{"
	echo "  \"name\": \"domia-core\","
	echo "  \"version\": \"$VERSION\","
	echo "  \"commit\": \"$COMMIT\","
	echo "  \"builtAt\": \"$BUILT_AT\","
	echo "  \"builtOn\": { \"platform\": \"$PLATFORM\", \"arch\": \"$ARCH\", \"node\": \"$(node --version)\" },"
	echo "  \"requires\": { \"node\": \"$(node -p "require('./package.json').engines.node")\", \"install\": \"npm ci\", \"binaries\": [\"sox\"] },"
	echo "  \"entry\": \"build/index.js\","
	echo "  \"start\": \"node --env-file=.env build/index.js\","
	echo "  \"files\": {"
	first=1
	while IFS= read -r f; do
		rel="${f#$STAGE/$NAME/}"
		[ $first -eq 1 ] || echo ","
		first=0
		printf '    "%s": "%s"' "$rel" "$(sha256_of "$f")"
	done < <(find "$STAGE/$NAME" -type f ! -name MANIFEST.json | sort)
	echo ""
	echo "  }"
	echo "}"
} > "$STAGE/$NAME/MANIFEST.json"

mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/$NAME.tar.gz"
tar -C "$STAGE" -czf "$TARBALL" "$NAME"
echo "$(sha256_of "$TARBALL")  $NAME.tar.gz" > "$TARBALL.sha256"
echo "✅ $TARBALL ($(du -h "$TARBALL" | cut -f1)) · sha256 in $TARBALL.sha256"
echo "   deploy: tar xzf $NAME.tar.gz && cd $NAME && npm ci && cp .env.example .env && npm run db:reset && npm start   (see docs/DEPLOY.md)"
