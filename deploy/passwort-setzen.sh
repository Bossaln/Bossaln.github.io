#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – Portal-Passwort auf dem Pi neu setzen
#
#     sudo bash deploy/passwort-setzen.sh
#
# Für den Fall, dass das Portal-Passwort vergessen wurde. Normalerweise lässt
# es sich bequemer im Portal selbst unter „Passwort ändern“ wechseln.
# Gespeichert wird nur ein PBKDF2-Prüfwert, niemals das Passwort selbst.
# ============================================================================

set -euo pipefail

DATEN="${MELLIS_DATEN:-/var/lib/mellis-website}"
ZIEL="$DATEN/zugang.json"
DIENST="mellis-website"

if [ "$(id -u)" -ne 0 ]; then
  printf '\033[31mBitte mit sudo starten:  sudo bash deploy/passwort-setzen.sh\033[0m\n'
  exit 1
fi

read -r -s -p "Neues Portal-Passwort (mind. 12 Zeichen): " PASSWORT; echo
read -r -s -p "Zur Sicherheit noch einmal:                " WDH; echo

if [ "${#PASSWORT}" -lt 12 ]; then
  printf '\033[31mDas Passwort ist zu kurz (mindestens 12 Zeichen).\033[0m\n'
  exit 1
fi
if [ "$PASSWORT" != "$WDH" ]; then
  printf '\033[31mDie beiden Eingaben stimmen nicht überein.\033[0m\n'
  exit 1
fi

mkdir -p "$DATEN"
PASSWORT="$PASSWORT" node -e '
const c = require("crypto");
const pw = process.env.PASSWORT;
const iterationen = 310000;
const salz = c.randomBytes(16);
const hash = c.pbkdf2Sync(pw, salz, iterationen, 32, "sha256");
process.stdout.write(JSON.stringify({
  hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
  algorithmus: "PBKDF2-SHA256",
  iterationen,
  salz: salz.toString("hex"),
  hash: hash.toString("hex"),
}, null, 2) + "\n");
' > "$ZIEL.neu"

mv "$ZIEL.neu" "$ZIEL"
BESITZER="$(stat -c %U:%G "$DATEN")"
chown "$BESITZER" "$ZIEL"
chmod 640 "$ZIEL"

systemctl restart "$DIENST" 2>/dev/null || true

printf '\033[32mFertig – das neue Passwort gilt ab sofort.\033[0m\n'
