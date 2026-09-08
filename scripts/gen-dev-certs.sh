#!/usr/bin/env bash
# Self-signed dev CA + one node certificate (HTTPS + gRPC TLS). Cross-OS: needs only openssl.
# Usage: scripts/gen-dev-certs.sh [node-name] [out-dir] [extra SAN ...]
#   node-name  label for the cert files (default: domia)
#   out-dir    default: data/certs
#   extra SAN  DNS:name or IP:addr entries appended to the SAN list
set -euo pipefail

NODE_NAME="${1:-domia}"
OUT_DIR="${2:-data/certs}"
shift $(( $# >= 2 ? 2 : $# )) || true
EXTRA_SANS=("$@")
DAYS="${DOMIA_CERT_DAYS:-825}"

command -v openssl >/dev/null 2>&1 || { echo "❌ openssl not found (macOS: built in · Debian/RPi OS: sudo apt install openssl)"; exit 1; }

mkdir -p "$OUT_DIR"
CA_KEY="$OUT_DIR/ca.key"
CA_CRT="$OUT_DIR/ca.crt"
KEY="$OUT_DIR/$NODE_NAME.key"
CSR="$OUT_DIR/$NODE_NAME.csr"
CRT="$OUT_DIR/$NODE_NAME.crt"
EXT="$OUT_DIR/$NODE_NAME.ext"

local_ips() {
	if command -v ip >/dev/null 2>&1; then
		ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1
	elif command -v ifconfig >/dev/null 2>&1; then
		ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}'
	elif command -v hostname >/dev/null 2>&1; then
		hostname -I 2>/dev/null | tr ' ' '\n'
	fi
}

SANS="DNS:localhost,IP:127.0.0.1,IP:::1"
[ "$NODE_NAME" != "localhost" ] && SANS="$SANS,DNS:$NODE_NAME"
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"
[ -n "$HOST_SHORT" ] && SANS="$SANS,DNS:$HOST_SHORT"
HOST_FULL="$(hostname -f 2>/dev/null || true)"
[ -n "$HOST_FULL" ] && [ "$HOST_FULL" != "$HOST_SHORT" ] && SANS="$SANS,DNS:$HOST_FULL"
for ip in $(local_ips | sort -u); do
	case "$ip" in
		169.254.*|"") ;;
		*) SANS="$SANS,IP:$ip" ;;
	esac
done
for san in "${EXTRA_SANS[@]:-}"; do
	[ -n "$san" ] && SANS="$SANS,$san"
done

if [ -f "$CA_KEY" ] && [ -f "$CA_CRT" ]; then
	echo "✅ reusing dev CA $CA_CRT"
elif [ ! -f "$CA_KEY" ] && [ ! -f "$CA_CRT" ]; then
	echo "🔏 creating dev CA in $OUT_DIR"
	openssl genrsa -out "$CA_KEY" 4096 >/dev/null 2>&1
	openssl req -x509 -new -key "$CA_KEY" -sha256 -days "$DAYS" -subj "/CN=Domia Dev CA" -out "$CA_CRT"
	chmod 600 "$CA_KEY"
else
	echo "❌ dev CA is half-present (one of ca.key/ca.crt is missing) — refusing to regenerate and invalidate already-issued certs. Remove both $CA_KEY and $CA_CRT to recreate." >&2
	exit 1
fi

echo "🔐 issuing $NODE_NAME certificate (SAN: $SANS)"
openssl genrsa -out "$KEY" 2048 >/dev/null 2>&1
chmod 600 "$KEY"
openssl req -new -key "$KEY" -subj "/CN=$NODE_NAME" -out "$CSR"
cat > "$EXT" <<EOT
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=$SANS
EOT
openssl x509 -req -in "$CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial -days "$DAYS" -sha256 -extfile "$EXT" -out "$CRT" 2>/dev/null
rm -f "$CSR" "$EXT"

cat <<EOT

✅ certificates ready in $OUT_DIR
   add to the node's env file:
     DOMIA_TLS_CERT_FILE=$CRT
     DOMIA_TLS_KEY_FILE=$KEY
     DOMIA_TLS_CA_FILE=$CA_CRT
   copy ca.crt to every peer node (same DOMIA_TLS_CA_FILE) and export
     NODE_EXTRA_CA_CERTS=$(cd "$OUT_DIR" && pwd)/ca.crt
   for any client that calls this node over HTTPS (evals, curl --cacert, the console).
   If the node's LAN IP changes, re-run this script (the IP is in the SAN list).
EOT
