#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – neue Version der Website holen
#
#     bash deploy/update.sh
#
# Holt die aktuelle Version von GitHub und startet den Dienst neu.
# Die im Portal gepflegten Inhalte und Bilder liegen außerhalb des
# Website-Ordners (/var/lib/mellis-website) und bleiben unangetastet.
# ============================================================================

set -euo pipefail

DIENST="mellis-website"
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '\033[1mWebsite-Ordner: %s\033[0m\n' "$WEB"

if [ ! -d "$WEB/.git" ]; then
  printf '\033[31mKein Git-Ordner gefunden – Update bitte von Hand einspielen.\033[0m\n'
  exit 1
fi

echo "Neue Version wird geholt …"
git -C "$WEB" pull --ff-only

echo "Dienst wird neu gestartet …"
sudo systemctl restart "$DIENST"
sleep 2

if systemctl is-active --quiet "$DIENST"; then
  printf '\033[32mFertig – die Website läuft mit der neuen Version.\033[0m\n'
else
  printf '\033[31mDer Dienst läuft nicht. Protokoll:\033[0m\n'
  sudo journalctl -u "$DIENST" -n 30 --no-pager
  exit 1
fi
