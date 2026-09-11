#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – ist die Website im Internet erreichbar?
#
#     bash deploy/domain-pruefen.sh              # nutzt die eingerichtete Domain
#     bash deploy/domain-pruefen.sh meine.de     # eine andere prüfen
#
# Geht die Kette vom Pi bis zum Besucher Schritt für Schritt durch und sagt
# im Klartext, wo es hakt.
# ============================================================================

set -uo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && DOMAIN="$(cat /etc/cloudflared/mellis-domain 2>/dev/null || true)"
DOMAIN="${DOMAIN:-pexel.space}"
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/^www\.//')"

WEBDIENST="mellis-website"
TUNNELDIENST="mellis-tunnel"
FEHLT=0

ja()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
nein() { printf '  \033[31m✗\033[0m %s\n' "$*"; FEHLT=$((FEHLT + 1)); }
hm()   { printf '  \033[33m•\033[0m %s\n' "$*"; }
titel(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

PORT="$(sed -n 's/^Environment=MELLIS_PORT=//p' "/etc/systemd/system/$WEBDIENST.service" 2>/dev/null | tail -1)"
PORT="${PORT:-8080}"

printf '\033[1m═══ %s ═══\033[0m\n' "$DOMAIN"

# --------------------------------------------------------------------------
titel "1. Die Website auf dem Pi"
# --------------------------------------------------------------------------
if systemctl is-active --quiet "$WEBDIENST"; then
  ja "Dienst $WEBDIENST läuft"
else
  nein "Dienst $WEBDIENST läuft nicht  →  sudo systemctl start $WEBDIENST"
fi

STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" 2>/dev/null)"
if [ "$STATUS" = "200" ]; then
  ja "Antwortet auf http://127.0.0.1:$PORT/ (HTTP $STATUS)"
else
  nein "Keine Antwort auf http://127.0.0.1:$PORT/ (HTTP ${STATUS:-—})"
fi

# --------------------------------------------------------------------------
titel "2. Der Tunnel zu Cloudflare"
# --------------------------------------------------------------------------
if systemctl is-active --quiet "$TUNNELDIENST"; then
  ja "Dienst $TUNNELDIENST läuft"
else
  nein "Dienst $TUNNELDIENST läuft nicht  →  sudo systemctl start $TUNNELDIENST"
fi

if grep -q -- "--config" "/etc/systemd/system/$TUNNELDIENST.service" 2>/dev/null; then
  ja "Benannter Tunnel – feste Adresse"
else
  hm "Noch der Quick Tunnel mit wechselnder Zufallsadresse"
  hm "Feste Adresse einrichten:  sudo bash deploy/domain-einrichten.sh $DOMAIN"
fi

VERBINDUNGEN="$(journalctl -u "$TUNNELDIENST" --since "-24 hours" --no-pager 2>/dev/null \
                | grep -c 'Registered tunnel connection')"
if [ "${VERBINDUNGEN:-0}" -gt 0 ]; then
  ja "Verbindung zu Cloudflare steht"
else
  nein "Keine Verbindung zu Cloudflare  →  journalctl -u $TUNNELDIENST -n 30"
fi

# --------------------------------------------------------------------------
titel "3. Die Nameserver der Domain"
# --------------------------------------------------------------------------
NS="$(dig +short NS "$DOMAIN" @1.1.1.1 2>/dev/null | tr 'A-Z' 'a-z' | sed 's/\.$//')"
if [ -z "$NS" ]; then
  nein "Für $DOMAIN sind keine Nameserver auffindbar"
elif printf '%s' "$NS" | grep -q 'ns\.cloudflare\.com'; then
  ja "Zeigen auf Cloudflare:"
  printf '      %s\n' $NS
else
  nein "Zeigen noch NICHT auf Cloudflare:"
  printf '      %s\n' $NS
  hm "Beim Registrar (Strato) die beiden Nameserver eintragen, die"
  hm "Cloudflare im Dashboard unter der Domain anzeigt. Danach dauert"
  hm "die Umstellung meist ein paar Stunden – nichts weiter zu tun."
fi

# --------------------------------------------------------------------------
titel "4. Der Eintrag für die Domain"
# --------------------------------------------------------------------------
for name in "$DOMAIN" "www.$DOMAIN"; do
  ZIEL="$(dig +short "$name" @1.1.1.1 2>/dev/null | head -3 | tr '\n' ' ')"
  if [ -n "$ZIEL" ]; then
    ja "$name → ${ZIEL% }"
  else
    nein "$name hat keinen Eintrag"
  fi
done

# --------------------------------------------------------------------------
titel "5. Der Aufruf von außen"
# --------------------------------------------------------------------------
SEITE="$(mktemp)"
ANTWORT="$(curl -s -o "$SEITE" -w '%{http_code}' --max-time 15 "https://$DOMAIN/" 2>/dev/null)"

# Cloudflare kann eine Zwischenseite („Just a moment …") vorschalten. Echte
# Browser lösen die still auf, dieses Skript und Suchmaschinen aber nicht.
if grep -qi 'Just a moment\|Checking your browser\|cf-browser-verification' "$SEITE" 2>/dev/null; then
  nein "Cloudflare schaltet eine Prüfseite davor (HTTP $ANTWORT, „Just a moment …“)"
  hm "Besucher mit Browser kommen durch, Suchmaschinen dagegen nicht."
  hm "Abschalten im Cloudflare-Dashboard unter der Domain:"
  hm "  Security → Bots → „Bot Fight Mode“ ausschalten"
  hm "  Security → Settings → Security Level auf „Medium“ (nicht „Under Attack“)"
else
  case "$ANTWORT" in
    200) ja "https://$DOMAIN/ antwortet (HTTP 200) – die Seite ist online" ;;
    000) nein "https://$DOMAIN/ nicht erreichbar (Name lässt sich nicht auflösen)" ;;
    52*|53*) nein "https://$DOMAIN/ meldet HTTP $ANTWORT – Cloudflare erreicht den Pi nicht" ;;
    *)   nein "https://$DOMAIN/ antwortet mit HTTP ${ANTWORT:-—}" ;;
  esac
fi
rm -f "$SEITE"

WEITER="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "https://www.$DOMAIN/" 2>/dev/null)"
case "$WEITER" in
  301*|308*) ja "https://www.$DOMAIN/ leitet weiter auf ${WEITER#* }" ;;
  200*)      ja "https://www.$DOMAIN/ antwortet (HTTP 200)" ;;
  *)         hm "https://www.$DOMAIN/ → ${WEITER:-keine Antwort}" ;;
esac

TITELZEILE="$(curl -s --max-time 15 "https://$DOMAIN/" 2>/dev/null | sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' | head -1)"
case "$TITELZEILE" in
  ""|*"Just a moment"*) : ;;
  *) ja "Ausgeliefert wird: „$TITELZEILE“" ;;
esac

# --------------------------------------------------------------------------
echo
if [ "$FEHLT" -eq 0 ]; then
  printf '\033[32m═══════════════════════════════════════════════\033[0m\n'
  printf '\033[32m Alles in Ordnung – die Website ist online.\033[0m\n'
  printf '\033[32m═══════════════════════════════════════════════\033[0m\n'
  echo
  echo "   https://$DOMAIN"
  echo "   https://$DOMAIN/admin.html   (Portal)"
else
  printf '\033[33m%s Punkt(e) sind noch offen – siehe die Zeilen mit ✗ oben.\033[0m\n' "$FEHLT"
fi
echo
