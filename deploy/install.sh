#!/usr/bin/env bash
# ============================================================================
# Melli's Krabbelzwerge – Einrichtung auf dem Raspberry Pi
#
# Richtet die Website als Dienst ein, der beim Einschalten des Pi automatisch
# startet. Aufruf (im Ordner der Website):
#
#     sudo bash deploy/install.sh
#
# Optional:  sudo MELLIS_PORT=8080 bash deploy/install.sh
# ============================================================================

set -euo pipefail

DIENST="mellis-website"
DATEN="${MELLIS_DATEN:-/var/lib/mellis-website}"
PORT="${MELLIS_PORT:-80}"

rot()  { printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[1m%s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  rot "Bitte mit sudo starten:  sudo bash deploy/install.sh"
  exit 1
fi

# Ordner der Website = der Ordner über diesem Skript
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$WEB/server/server.js" ]; then
  rot "server/server.js nicht gefunden. Das Skript bitte aus dem Website-Ordner starten."
  exit 1
fi

# Der Dienst läuft unter dem Benutzer, dem der Website-Ordner gehört
BENUTZER="${SUDO_USER:-$(stat -c %U "$WEB")}"
GRUPPE="$(id -gn "$BENUTZER")"

info "Website-Ordner: $WEB"
info "Datenordner:    $DATEN"
info "Benutzer:       $BENUTZER"
info "Port:           $PORT"
echo

# --------------------------------------------------------------------------
# 1. Node.js sicherstellen
# --------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  info "Node.js wird installiert …"
  apt-get update
  apt-get install -y nodejs
fi

NODE="$(command -v node)"
NODE_VERSION="$("$NODE" -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_VERSION" -lt 16 ]; then
  rot "Node.js ist zu alt (v$NODE_VERSION). Nötig ist mindestens Version 16."
  echo "Neuere Version installieren:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi
gruen "Node.js $("$NODE" -v) gefunden ($NODE)"

# --------------------------------------------------------------------------
# 2. Datenordner anlegen (überlebt jedes Update der Website)
# --------------------------------------------------------------------------
mkdir -p "$DATEN/bilder" "$DATEN/sicherungen"
for datei in inhalte.json zugang.json; do
  if [ ! -f "$DATEN/$datei" ] && [ -f "$WEB/daten/$datei" ]; then
    cp "$WEB/daten/$datei" "$DATEN/$datei"
    echo "  übernommen: $datei"
  fi
done
chown -R "$BENUTZER:$GRUPPE" "$DATEN"
chmod 750 "$DATEN"
chmod 640 "$DATEN/zugang.json" 2>/dev/null || true
gruen "Datenordner bereit: $DATEN"

# --------------------------------------------------------------------------
# 3. Ist der Port überhaupt frei?
# --------------------------------------------------------------------------
LIEF_SCHON="nein"
if systemctl is-active --quiet "$DIENST" 2>/dev/null; then
  LIEF_SCHON="ja"
  systemctl stop "$DIENST"   # eigener Dienst blockiert sonst den eigenen Port
fi

if command -v ss >/dev/null 2>&1; then
  BELEGUNG="$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" 'index($4, p) && substr($4, length($4) - length(p) + 1) == p')"
  if [ -n "$BELEGUNG" ]; then
    PROGRAMM="$(printf '%s' "$BELEGUNG" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1)"
    [ -z "$PROGRAMM" ] && PROGRAMM="ein anderes Programm"

    rot "Port $PORT ist bereits belegt – von: $PROGRAMM"
    echo
    echo "Es gibt zwei Wege:"
    echo
    echo "  1. Die Website auf einen anderen Port legen (nichts anderes ändert sich):"
    echo "       sudo MELLIS_PORT=8080 bash deploy/install.sh"
    echo "     → erreichbar unter http://$(hostname).local:8080/"
    echo
    echo "  2. Das andere Programm abschalten – nur, wenn es nicht gebraucht wird:"
    echo "       sudo systemctl disable --now $PROGRAMM"
    echo "       sudo bash deploy/install.sh"
    echo
    echo "     Achtung: „lighttpd“ gehört meistens zu Pi-hole und sollte bleiben."
    echo "     In dem Fall besser Weg 1 wählen."
    echo

    [ "$LIEF_SCHON" = "ja" ] && systemctl start "$DIENST"
    exit 1
  fi
fi
gruen "Port $PORT ist frei"

# --------------------------------------------------------------------------
# 4. Dienst einrichten
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Protokolle nach 30 Tagen löschen
#
# Der Dienst schreibt Ereignisse (Anmeldungen am Portal, Versand von
# Kontaktanfragen, Fehler) ins Systemprotokoll – teils mit IP-Adresse. Die
# Datenschutzerklärung sagt zu, dass diese Einträge spätestens nach 30 Tagen
# verschwinden. Genau das stellt diese Einstellung sicher.
# --------------------------------------------------------------------------
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/50-mellis-website.conf <<JOURNALDATEI
[Journal]
MaxRetentionSec=30day
JOURNALDATEI
systemctl restart systemd-journald || true

cat > "/etc/systemd/system/$DIENST.service" <<DIENSTDATEI
[Unit]
Description=Melli's Krabbelzwerge – Website
Documentation=file://$WEB/deploy/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$BENUTZER
Group=$GRUPPE
WorkingDirectory=$WEB
Environment=NODE_ENV=production
Environment=MELLIS_WEB=$WEB
Environment=MELLIS_DATEN=$DATEN
Environment=MELLIS_PORT=$PORT
# Zugangsdaten für den E-Mail-Versand des Kontaktformulars (optional).
# Die Datei gehört root und ist nur für root lesbar – deshalb stehen die
# Zugangsdaten dort und nicht in dieser Dienstdatei.
EnvironmentFile=-/etc/mellis-website.env
ExecStart=$NODE $WEB/server/server.js
Restart=always
RestartSec=3

# Rechte klein halten
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
ReadWritePaths=$DATEN
MemoryMax=256M

[Install]
WantedBy=multi-user.target
DIENSTDATEI

systemctl daemon-reload
systemctl enable "$DIENST" >/dev/null
systemctl restart "$DIENST"
sleep 2

if ! systemctl is-active --quiet "$DIENST"; then
  rot "Der Dienst konnte nicht gestartet werden. Protokoll:"
  journalctl -u "$DIENST" -n 30 --no-pager
  exit 1
fi

# --------------------------------------------------------------------------
# 5. Fertig
# --------------------------------------------------------------------------
NAME="$(hostname)"
ADRESSEN="$(hostname -I 2>/dev/null || true)"
ANHANG=""
[ "$PORT" != "80" ] && ANHANG=":$PORT"

echo
gruen "════════════════════════════════════════════════════"
gruen " Die Website läuft und startet ab jetzt automatisch."
gruen "════════════════════════════════════════════════════"
echo
echo "  Im Heimnetz erreichbar unter:"
echo "    http://$NAME.local$ANHANG/"
for adresse in $ADRESSEN; do
  case "$adresse" in *:*) continue ;; esac   # IPv6 überspringen
  echo "    http://$adresse$ANHANG/"
done
echo
echo "  Verwaltungs-Portal:"
echo "    http://$NAME.local$ANHANG/admin.html"
echo

# Steht die Seite schon unter eigener Domain im Internet? Dann sagen, wie.
DOMAIN_DATEI="/etc/cloudflared/mellis-domain"
if [ -s "$DOMAIN_DATEI" ]; then
  echo "  Im Internet erreichbar unter:"
  echo "    https://$(cat "$DOMAIN_DATEI")/"
  echo
elif systemctl is-active --quiet mellis-tunnel 2>/dev/null; then
  echo "  Im Internet erreichbar – aktuelle Adresse zeigt:"
  echo "    mellis-tunnel-adresse"
  echo
  echo "  Feste Adresse unter eigener Domain einrichten:"
  echo "    sudo bash deploy/domain-einrichten.sh pexel.space"
  echo
fi
echo "  Bitte gleich nach dem ersten Anmelden im Portal unter"
echo "  „Wiederherstellungs-Codes“ einen Satz erzeugen und ausdrucken –"
echo "  damit ein vergessenes Passwort später kein Fall für die"
echo "  Kommandozeile ist."
echo
echo "  Nützliche Befehle:"
echo "    sudo systemctl status $DIENST     # läuft alles?"
echo "    sudo journalctl -u $DIENST -f     # Protokoll mitlesen"
echo "    sudo systemctl restart $DIENST    # neu starten"
echo "    bash deploy/update.sh             # neue Version holen"
echo "    sudo bash deploy/passwort-setzen.sh  # Portal-Passwort neu setzen"
echo
