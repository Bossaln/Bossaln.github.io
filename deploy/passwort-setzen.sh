#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – Portal-Passwort auf dem Pi neu setzen
#
#     sudo bash deploy/passwort-setzen.sh
#     sudo bash deploy/passwort-setzen.sh --neue-codes
#
# Für den Fall, dass das Portal-Passwort vergessen wurde und auch kein
# Wiederherstellungs-Code mehr zur Hand ist. Bequemer geht es im Portal
# selbst: „Passwort ändern“ bzw. „Passwort vergessen?“ auf der Anmeldeseite.
#
# Vorhandene Wiederherstellungs-Codes bleiben gültig – sie hängen nicht am
# Passwort. Gibt es noch keine (oder mit --neue-codes), wird ein frischer
# Satz erzeugt und hier ausgegeben: bitte ausdrucken und aufbewahren.
#
# Gespeichert wird nur ein PBKDF2-Prüfwert, niemals das Passwort selbst.
# ============================================================================

set -euo pipefail

DATEN="${MELLIS_DATEN:-/var/lib/mellis-website}"
ZIEL="$DATEN/zugang.json"
DIENST="mellis-website"
NEUE_CODES="nein"

[ "${1:-}" = "--neue-codes" ] && NEUE_CODES="ja"

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

# Die neuen Codes gibt das Node-Skript auf der Fehlerausgabe aus, damit die
# Zugangsdatei selbst sauber bleibt. Sie landen in einer Datei, die nur root
# lesen kann (mktemp legt sie mit 600 an) und die in jedem Fall wieder
# verschwindet – auch wenn das Skript unterwegs abbricht.
CODES="$(mktemp)"
trap 'rm -f "$CODES" "$ZIEL.neu"' EXIT

PASSWORT="$PASSWORT" ALT="$ZIEL" NEUE_CODES="$NEUE_CODES" node -e '
const fs = require("fs");
const c = require("crypto");

const iterationen = 310000;
const salz = c.randomBytes(16);
const hash = c.pbkdf2Sync(process.env.PASSWORT, salz, iterationen, 32, "sha256");

// Zeichen, die sich beim Abschreiben nicht verwechseln lassen (kein I, L, O, 0, 1)
const ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LAENGE = 15;
const ANZAHL = 8;

function codeErzeugen() {
  const grenze = 256 - (256 % ZEICHEN.length);
  let code = "";
  while (code.length < LAENGE) {
    for (const wert of c.randomBytes(LAENGE)) {
      if (wert >= grenze) continue;            // Rest verwerfen statt verbiegen
      code += ZEICHEN[wert % ZEICHEN.length];
      if (code.length === LAENGE) break;
    }
  }
  return code.replace(/(.{5})(?=.)/g, "$1-");
}

let alt = null;
try { alt = JSON.parse(fs.readFileSync(process.env.ALT, "utf8")); } catch { /* neu */ }

const vorhanden = alt && alt.wiederherstellung &&
  Array.isArray(alt.wiederherstellung.codes) && alt.wiederherstellung.codes.length;

let wiederherstellung = vorhanden ? alt.wiederherstellung : null;
if (!vorhanden || process.env.NEUE_CODES === "ja") {
  const codes = [];
  for (let i = 0; i < ANZAHL; i += 1) codes.push(codeErzeugen());
  const codeSalz = c.randomBytes(16).toString("hex");
  wiederherstellung = {
    hinweis: "Enthaelt nur Pruefwerte der Wiederherstellungs-Codes. Jeder Code gilt genau einmal.",
    algorithmus: "SHA-256",
    salz: codeSalz,
    codes: codes.map((code) => c.createHash("sha256")
      .update(Buffer.concat([Buffer.from(codeSalz, "hex"), Buffer.from(code.replace(/-/g, ""), "utf8")]))
      .digest("hex")),
  };
  process.stderr.write(codes.join("\n") + "\n");
}

process.stdout.write(JSON.stringify({
  hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
  algorithmus: "PBKDF2-SHA256",
  iterationen,
  salz: salz.toString("hex"),
  hash: hash.toString("hex"),
  wiederherstellung,
}, null, 2) + "\n");
' > "$ZIEL.neu" 2> "$CODES"

mv "$ZIEL.neu" "$ZIEL"
BESITZER="$(stat -c %U:%G "$DATEN")"
chown "$BESITZER" "$ZIEL"
chmod 640 "$ZIEL"

systemctl restart "$DIENST" 2>/dev/null || true

printf '\033[32mFertig – das neue Passwort gilt ab sofort.\033[0m\n'

if [ -s "$CODES" ]; then
  echo
  printf '\033[1mNeue Wiederherstellungs-Codes – bitte ausdrucken und aufbewahren:\033[0m\n'
  echo
  NUMMER=0
  while read -r CODE; do
    NUMMER=$((NUMMER + 1))
    printf '   %d. %s\n' "$NUMMER" "$CODE"
  done < "$CODES"
  echo
  echo "  Mit einem dieser Codes lässt sich im Portal unter „Passwort vergessen?“"
  echo "  ein neues Passwort setzen. Jeder Code gilt genau einmal."
  echo "  Sie werden hier zum einzigen Mal angezeigt."
else
  echo
  echo "  Die vorhandenen Wiederherstellungs-Codes gelten unverändert weiter."
  echo "  Einen frischen Satz gibt es mit:  sudo bash deploy/passwort-setzen.sh --neue-codes"
fi
