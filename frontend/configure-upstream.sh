#!/bin/sh
set -eu

upstream="${SAVRA_API_UPSTREAM:-backend:8000}"
if ! printf '%s\n' "$upstream" | awk '/^[a-zA-Z0-9.-]+:[0-9]+$/ { valid = 1 } END { exit !valid }'; then
  echo "SAVRA_API_UPSTREAM debe ser host:puerto" >&2
  exit 1
fi
resolver="$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)"
case "$resolver" in
  '') echo "Falta el resolver DNS del contenedor" >&2; exit 1 ;;
  *:*) resolver="[$resolver]" ;;
esac
printf 'resolver %s valid=5s ipv6=off;\nserver %s resolve;\n' "$resolver" "$upstream" > /tmp/savra-upstream.conf
