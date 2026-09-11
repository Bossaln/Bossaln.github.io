#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – feste Adresse im Internet (eigene Domain)
#
# Ersetzt den Quick Tunnel mit seiner wechselnden Zufallsadresse durch einen
# benannten Cloudflare-Tunnel. Danach ist die Website dauerhaft unter der
# eigenen Domain erreichbar – ohne Portfreigabe im Router, ohne feste
# Internet-Adresse, mit HTTPS von Cloudflare.
#
#     sudo bash deploy/domain-einrichten.sh                # pexel.space
#     sudo bash deploy/domain-einrichten.sh meine-seite.de # andere Domain
#
# Das Skript darf beliebig oft laufen – es richtet nur ein, was noch fehlt.
# ============================================================================

set -euo pipefail

DOMAIN="${1:-pexel.space}"
TUNNEL="${MELLIS_TUNNEL_NAME:-mellis}"
CF_ORDNER="/etc/cloudflared"
CERT="$CF_ORDNER/cert.pem"
KONFIG="$CF_ORDNER/config.yml"
DIENST="mellis-tunnel"
WEBDIENST="mellis-website"
UMGEBUNG="/etc/mellis-website.env"

rot()   { printf '\033[31m%s\033[0m\n' "$*"; }
gelb()  { printf '\033[33m%s\033[0m\n' "$*"; }
gruen() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1m%s\033[0m\n' "$*"; }
schritt(){ echo; printf '\033[1m── %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  rot "Bitte mit sudo starten:  sudo bash deploy/domain-einrichten.sh $DOMAIN"
  exit 1
fi

# Domain grob prüfen – ohne „www.", ohne „https://"
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/^www\.//')"
if ! printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9-]+(\.[a-z0-9-]+)+$'; then
  rot "„$DOMAIN\" sieht nicht wie eine Domain aus. Beispiel: pexel.space"
  exit 1
fi

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Auf welchem Port läuft die Website? Steht in der Dienstdatei.
PORT="$(sed -n 's/^Environment=MELLIS_PORT=//p' "/etc/systemd/system/$WEBDIENST.service" 2>/dev/null | tail -1)"
PORT="${PORT:-${MELLIS_PORT:-8080}}"

# Unter welchem Benutzer läuft der Tunnel?
BENUTZER="$(sed -n 's/^User=//p' "/etc/systemd/system/$DIENST.service" 2>/dev/null | tail -1)"
BENUTZER="${BENUTZER:-${SUDO_USER:-root}}"
GRUPPE="$(id -gn "$BENUTZER")"

CLOUDFLARED="$(command -v cloudflared || true)"
if [ -z "$CLOUDFLARED" ]; then
  rot "cloudflared ist nicht installiert."
  echo "Nachholen mit:"
  echo "  sudo apt-get install -y cloudflared"
  echo "  (oder das Paket von https://pkg.cloudflare.com laden)"
  exit 1
fi

info "Domain:      $DOMAIN  (und www.$DOMAIN)"
info "Tunnel:      $TUNNEL"
info "Website auf: http://127.0.0.1:$PORT"
info "Benutzer:    $BENUTZER"

mkdir -p "$CF_ORDNER"

# cloudflared braucht seine Dateien in HOME, wenn nichts anderes gesagt wird.
# Über diese Variable landen sie gleich im richtigen Ordner.
export TUNNEL_ORIGIN_CERT="$CERT"
cfd() { "$CLOUDFLARED" --origincert "$CERT" "$@"; }

# --------------------------------------------------------------------------
schritt "1. Anmeldung bei Cloudflare"
# --------------------------------------------------------------------------
if [ -s "$CERT" ]; then
  gruen "Anmeldung liegt schon vor ($CERT)"
else
  # Vielleicht wurde schon einmal angemeldet – dann liegt die Datei im HOME.
  for kandidat in "/root/.cloudflared/cert.pem" \
                  "$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.cloudflared/cert.pem"; do
    if [ -s "$kandidat" ]; then
      cp "$kandidat" "$CERT"
      gruen "Vorhandene Anmeldung übernommen aus $kandidat"
      break
    fi
  done
fi

if [ ! -s "$CERT" ]; then
  echo
  gelb "Jetzt einmalig bei Cloudflare anmelden."
  echo
  echo "  Gleich erscheint ein Link. Diesen Link auf einem Gerät mit Browser"
  echo "  öffnen (Handy oder PC – egal welches), bei Cloudflare anmelden und"
  echo "  dort die Domain $DOMAIN auswählen."
  echo
  echo "  Wichtig: Die Domain muss vorher im Cloudflare-Konto angelegt sein"
  echo "  (Add a domain → $DOMAIN → Free-Tarif). Die Nameserver müssen dafür"
  echo "  noch nicht umgestellt sein."
  echo
  gelb "  Der Link gilt nur wenige Minuten – also am besten gleich öffnen."
  echo "  Danach läuft dieses Skript von selbst weiter."
  echo

  # cloudflared legt die Anmeldung trotz --origincert im HOME ab; der Ordner
  # muss dafür existieren, sonst geht die Datei verloren.
  mkdir -p /root/.cloudflared

  "$CLOUDFLARED" tunnel login || true

  if [ ! -s "$CERT" ]; then
    for kandidat in "/root/.cloudflared/cert.pem" \
                    "$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.cloudflared/cert.pem"; do
      [ -s "$kandidat" ] && { cp "$kandidat" "$CERT"; break; }
    done
  fi
fi

if [ ! -s "$CERT" ]; then
  rot "Die Anmeldung hat nicht geklappt – ohne sie geht es nicht weiter."
  echo "Einfach noch einmal starten:"
  echo "  sudo bash deploy/domain-einrichten.sh $DOMAIN"
  exit 1
fi
chown root:root "$CERT"; chmod 644 "$CERT"
gruen "Bei Cloudflare angemeldet"

# --------------------------------------------------------------------------
schritt "2. Tunnel anlegen"
# --------------------------------------------------------------------------
# Kennung (UUID) des Tunnels aus der Liste holen – ohne Zusatzprogramme
kennung_von() {
  cfd tunnel list --output json 2>/dev/null | python3 -c '
import json, sys
gesucht = sys.argv[1]
try:
    liste = json.load(sys.stdin) or []
except Exception:
    liste = []
for eintrag in liste:
    if eintrag.get("name") != gesucht:
        continue
    # Cloudflare schickt fuer „nicht geloescht" den Nullzeitpunkt, nicht leer
    geloescht = str(eintrag.get("deleted_at") or "")
    if geloescht and not geloescht.startswith("0001-01-01"):
        continue
    print(eintrag.get("id", ""))
    break
' "$1"
}

KENNUNG="$(kennung_von "$TUNNEL")" || KENNUNG=""

if [ -z "$KENNUNG" ]; then
  echo "Tunnel „$TUNNEL“ wird angelegt …"
  cfd tunnel create "$TUNNEL" >/dev/null
  KENNUNG="$(kennung_von "$TUNNEL")" || KENNUNG=""
fi

if [ -z "$KENNUNG" ]; then
  rot "Der Tunnel konnte nicht angelegt werden."
  exit 1
fi
gruen "Tunnel „$TUNNEL\" bereit ($KENNUNG)"

# Schlüsseldatei des Tunnels einsammeln (cloudflared legt sie im HOME ab)
ZUGANG="$CF_ORDNER/$KENNUNG.json"
if [ ! -s "$ZUGANG" ]; then
  for kandidat in "/root/.cloudflared/$KENNUNG.json" \
                  "$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.cloudflared/$KENNUNG.json"; do
    [ -s "$kandidat" ] && { cp "$kandidat" "$ZUGANG"; break; }
  done
fi
if [ ! -s "$ZUGANG" ]; then
  rot "Die Schlüsseldatei des Tunnels ($KENNUNG.json) wurde nicht gefunden."
  echo "Der Tunnel existiert bei Cloudflare, der Schlüssel liegt aber nicht"
  echo "mehr auf dem Pi. Sauberster Weg – Tunnel neu anlegen:"
  echo "  sudo cloudflared --origincert $CERT tunnel delete $TUNNEL"
  echo "  sudo bash deploy/domain-einrichten.sh $DOMAIN"
  exit 1
fi
chown "$BENUTZER:$GRUPPE" "$ZUGANG"; chmod 600 "$ZUGANG"

# --------------------------------------------------------------------------
schritt "3. Wegweiser schreiben (welche Adresse zu welchem Dienst)"
# --------------------------------------------------------------------------
cat > "$KONFIG" <<KONFIGDATEI
# Wegweiser für den Cloudflare-Tunnel von Melli's Krabbelzwerge.
# Geschrieben von deploy/domain-einrichten.sh – Änderungen von Hand gehen
# beim nächsten Lauf verloren.

tunnel: $KENNUNG
credentials-file: $ZUGANG

# Verbindungen zügig wieder aufbauen, falls das Internet kurz weg war
retries: 5
grace-period: 30s

ingress:
  - hostname: $DOMAIN
    service: http://127.0.0.1:$PORT
  - hostname: www.$DOMAIN
    service: http://127.0.0.1:$PORT
  # Alles andere ins Leere laufen lassen
  - service: http_status:404
KONFIGDATEI
chown "$BENUTZER:$GRUPPE" "$KONFIG"; chmod 644 "$KONFIG"
printf '%s\n' "$DOMAIN" > "$CF_ORDNER/mellis-domain"
gruen "Wegweiser geschrieben: $KONFIG"

if ! "$CLOUDFLARED" --config "$KONFIG" tunnel ingress validate >/dev/null 2>&1; then
  rot "Der Wegweiser wurde von cloudflared beanstandet:"
  "$CLOUDFLARED" --config "$KONFIG" tunnel ingress validate || true
  exit 1
fi
gruen "Wegweiser geprüft"

# --------------------------------------------------------------------------
schritt "4. Domain auf den Tunnel zeigen lassen"
# --------------------------------------------------------------------------
# „cloudflared tunnel route dns" legt nur neue Einträge an. Steht an der
# Adresse schon etwas – nach einem Umzug zu Cloudflare typischerweise die
# A-Adresse des vorigen Anbieters –, übernimmt das Hilfsskript: es schreibt
# den vorhandenen Eintrag an Ort und Stelle um, ohne dass der Name auch nur
# eine Sekunde lang ins Leere zeigt.
DNS_OK="ja"

if python3 "$WEB/deploy/dns-eintrag.py" "$KENNUNG" "$DOMAIN" "www.$DOMAIN"; then
  gruen "Einträge stehen"
else
  DNS_OK="nein"
fi

if [ "$DNS_OK" = "nein" ]; then
  echo
  gelb "Die Einträge ließen sich nicht setzen. Die häufigsten Gründe:"
  echo
  echo "  · $DOMAIN ist im Cloudflare-Konto noch nicht angelegt"
  echo "    → Dashboard: „Add a domain“ → $DOMAIN → Free-Tarif"
  echo
  echo "  · Die Anmeldung gilt für eine andere Domain"
  echo "    → sudo rm $CERT && sudo bash deploy/domain-einrichten.sh $DOMAIN"
  echo
  echo "  Der Tunnel selbst wird trotzdem fertig eingerichtet."
fi

# --------------------------------------------------------------------------
schritt "5. Die Domain auch dem Webserver bekannt machen"
# --------------------------------------------------------------------------
# Damit www.$DOMAIN sauber auf $DOMAIN weiterleitet. Die Datei wird vom
# Dienst mitgelesen und übersteht jedes deploy/install.sh.
touch "$UMGEBUNG"; chmod 600 "$UMGEBUNG"; chown root:root "$UMGEBUNG"
if grep -q '^MELLIS_DOMAIN=' "$UMGEBUNG" 2>/dev/null; then
  sed -i "s#^MELLIS_DOMAIN=.*#MELLIS_DOMAIN=$DOMAIN#" "$UMGEBUNG"
else
  printf 'MELLIS_DOMAIN=%s\n' "$DOMAIN" >> "$UMGEBUNG"
fi
gruen "MELLIS_DOMAIN=$DOMAIN in $UMGEBUNG hinterlegt"

# Den Suchmaschinen-Schalter sichtbar machen – aber nie eine bestehende
# Freigabe zurücknehmen. Standard ist „nein": eine Probe-Adresse gehört
# nicht in den Google-Index.
if ! grep -q '^MELLIS_SUCHMASCHINEN=' "$UMGEBUNG" 2>/dev/null; then
  printf 'MELLIS_SUCHMASCHINEN=nein\n' >> "$UMGEBUNG"
  gelb "MELLIS_SUCHMASCHINEN=nein – die Seite bleibt vorerst aus Google heraus"
  echo "  Freigeben, sobald die endgültige Domain steht:"
  echo "    sudo sed -i 's/^MELLIS_SUCHMASCHINEN=.*/MELLIS_SUCHMASCHINEN=ja/' $UMGEBUNG"
  echo "    sudo systemctl restart $WEBDIENST"
else
  gruen "Suchmaschinen-Schalter: $(sed -n 's/^MELLIS_SUCHMASCHINEN=//p' "$UMGEBUNG" | tail -1)"
fi
systemctl restart "$WEBDIENST" || true

# --------------------------------------------------------------------------
schritt "6. Tunnel-Dienst auf die feste Adresse umstellen"
# --------------------------------------------------------------------------
cat > "/etc/systemd/system/$DIENST.service" <<DIENSTDATEI
[Unit]
Description=Melli's Krabbelzwerge – Cloudflare-Tunnel ($DOMAIN)
Documentation=file://$WEB/deploy/README.md
After=network-online.target $WEBDIENST.service
Wants=network-online.target
Requires=$WEBDIENST.service

[Service]
Type=simple
User=$BENUTZER
Group=$GRUPPE

# Benannter Tunnel: feste Adresse unter der eigenen Domain.
# Welche Adresse wohin geht, steht in $KONFIG.
ExecStart=$CLOUDFLARED --no-autoupdate --loglevel info \\
          --config $KONFIG tunnel run

Restart=always
RestartSec=5

# Rechte klein halten
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
ReadOnlyPaths=$CF_ORDNER
MemoryMax=128M

[Install]
WantedBy=multi-user.target
DIENSTDATEI

systemctl daemon-reload
systemctl enable "$DIENST" >/dev/null
systemctl restart "$DIENST"

# cloudflared prüft beim Start erst das Netz (DNS, UDP, TCP) und meldet sich
# dann bei mehreren Rechenzentren an. Das dauert je nach Leitung bis zu einer
# knappen Minute – entsprechend geduldig wird hier gewartet.
echo "Der Tunnel baut die Verbindung auf …"
VERBUNDEN="nein"
SEIT="$(date +%s)"
for _ in $(seq 1 60); do
  sleep 1
  if ! systemctl is-active --quiet "$DIENST"; then break; fi
  if journalctl -u "$DIENST" --since "@$SEIT" --no-pager 2>/dev/null \
     | grep -q "Registered tunnel connection"; then
    VERBUNDEN="ja"
    break
  fi
done

# Zweite Meinung: Cloudflare selbst fragen, wie viele Verbindungen ankommen.
# Das Protokoll kann hinterherhinken – die Gegenseite weiß es genau.
if [ "$VERBUNDEN" != "ja" ]; then
  ANZAHL="$(cfd tunnel list --output json 2>/dev/null | python3 -c '
import json, sys
gesucht = sys.argv[1]
try:
    liste = json.load(sys.stdin) or []
except Exception:
    liste = []
for eintrag in liste:
    if eintrag.get("id") == gesucht:
        print(len(eintrag.get("connections") or []))
        break
else:
    print(0)
' "$KENNUNG")" || ANZAHL=0
  [ "${ANZAHL:-0}" -gt 0 ] && VERBUNDEN="ja"
fi

if [ "$VERBUNDEN" != "ja" ] || ! systemctl is-active --quiet "$DIENST"; then
  rot "Der Tunnel ist noch nicht verbunden. Protokoll:"
  journalctl -u "$DIENST" -n 25 --no-pager
  exit 1
fi
gruen "Tunnel verbunden und beim Einschalten des Pi automatisch dabei"

# Der kleine Helfer „mellis-tunnel-adresse" soll die neue Lage kennen
if [ -f "$WEB/deploy/mellis-tunnel-adresse" ]; then
  install -m 755 "$WEB/deploy/mellis-tunnel-adresse" /usr/local/bin/mellis-tunnel-adresse
fi

# --------------------------------------------------------------------------
schritt "Fertig"
# --------------------------------------------------------------------------
NS="$(dig +short NS "$DOMAIN" 2>/dev/null | tr 'A-Z' 'a-z' || true)"
echo
gruen "════════════════════════════════════════════════════════════"
if printf '%s' "$NS" | grep -q 'ns\.cloudflare\.com'; then
  gruen " Die Website ist im Internet erreichbar:"
  echo
  echo "     https://$DOMAIN"
  echo "     https://www.$DOMAIN   (leitet auf die Adresse oben)"
  echo
  echo "   Portal zum Pflegen der Inhalte:"
  echo "     https://$DOMAIN/admin.html"
else
  gelb " Alles eingerichtet – es fehlt nur noch der Nameserver-Wechsel."
  echo
  echo "   Aktuell zeigt $DOMAIN noch auf:"
  printf '     %s\n' ${NS:-unbekannt}
  echo
  echo "   Sobald beim Registrar (Strato) die beiden Cloudflare-Nameserver"
  echo "   eingetragen sind und Cloudflare die Domain als „Active\" führt,"
  echo "   ist die Seite ohne weiteres Zutun erreichbar unter:"
  echo
  echo "     https://$DOMAIN"
  echo "     https://www.$DOMAIN"
  echo
  echo "   Prüfen lässt sich das jederzeit mit:"
  echo "     bash deploy/domain-pruefen.sh"
fi
gruen "════════════════════════════════════════════════════════════"
echo
echo "  Im Heimnetz bleibt die Seite wie gewohnt erreichbar:"
echo "    http://$(hostname).local:$PORT/"
echo
echo "  Nützliche Befehle:"
echo "    bash deploy/domain-pruefen.sh          # ist alles online?"
echo "    sudo systemctl status $DIENST      # läuft der Tunnel?"
echo "    journalctl -u $DIENST -f           # Protokoll mitlesen"
echo
