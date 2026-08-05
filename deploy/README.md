# Website auf dem Raspberry Pi 5 betreiben

Diese Anleitung bringt die Website von Melli's Krabbelzwerge als **echten
Webserver** auf den Raspberry Pi. Danach gilt:

* Der Pi liefert die Website aus – ohne GitHub Pages.
* Das Verwaltungs-Portal speichert Änderungen **direkt auf dem Pi**.
  Ein Klick auf „Jetzt veröffentlichen“ genügt, keine Dateien mehr
  herunterladen und hochladen.
* Der Dienst startet automatisch mit, wenn der Pi eingeschaltet wird.

Eingerichtet wird zunächst der Betrieb **im Heimnetz**. Der Schritt ins
offene Internet ist später ohne Umbau möglich – siehe ganz unten.

---

## Was du brauchst

* Raspberry Pi 5 mit Raspberry Pi OS (Bookworm oder neuer)
* Zugang zum Pi: entweder Monitor und Tastatur oder SSH vom Rechner aus
* Der Pi sollte per LAN-Kabel oder WLAN am Router hängen

---

## Schritt 1 – Auf dem Pi anmelden

Am Rechner ein Terminal öffnen (Windows: PowerShell) und verbinden:

```bash
ssh pi@raspberrypi.local
```

`pi` durch deinen Benutzernamen ersetzen, falls du beim Einrichten einen
anderen gewählt hast. Klappt der Name nicht, funktioniert auch die
IP-Adresse des Pi (steht im Router unter „Netzwerk“ / „Geräte“).

---

## Schritt 2 – Grundausstattung installieren

```bash
sudo apt update
sudo apt install -y git nodejs
```

Kurz prüfen, ob Node.js mindestens Version 16 ist:

```bash
node -v
```

Ist die Version älter, hilft:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## Schritt 3 – Website auf den Pi holen

```bash
cd ~
git clone -b claude/raspberry-pi-website-deploy-ig0cwr \
  https://github.com/Bossaln/Bossaln.github.io.git mellis-website
cd mellis-website
```

> Sobald der Branch im Repository zusammengeführt ist, reicht
> `git clone https://github.com/Bossaln/Bossaln.github.io.git mellis-website`
> ohne die `-b …`-Zeile.

---

## Schritt 4 – Einrichten

```bash
sudo bash deploy/install.sh
```

Das Skript

1. prüft Node.js,
2. legt den Datenordner `/var/lib/mellis-website` an und übernimmt die
   aktuellen Inhalte und das Portal-Passwort,
3. richtet den Dienst `mellis-website` ein (Autostart beim Einschalten),
4. startet ihn und zeigt die Adressen an, unter denen die Website läuft.

Am Ende steht dort z. B.:

```
  Im Heimnetz erreichbar unter:
    http://raspberrypi.local/
    http://192.168.178.42/

  Verwaltungs-Portal:
    http://raspberrypi.local/admin.html
```

Diese Adresse im Browser öffnen – die Website ist live. 🎉

---

## Schritt 5 – Portal testen

1. `http://raspberrypi.local/admin.html` öffnen
2. Mit dem gewohnten Passwort anmelden
3. Z. B. die Telefonnummer ändern → **„Jetzt veröffentlichen“**
4. Website in einem anderen Browser (oder am Handy) öffnen – die Änderung
   ist sofort da, auf allen Geräten.

Im Portal steht jetzt „Jetzt veröffentlichen“ statt „Datei exportieren“.
Das ist das Zeichen dafür, dass es den Pi-Server erkannt hat.

Im Portal gibt es diese Bereiche: Betreuungszeiten, Kontaktdaten, Slogan,
Neuigkeiten, Galerie, Veröffentlichen und Passwort ändern. **Bilder** landen
dabei direkt auf dem Pi und werden nicht in die Inhaltsdatei gepackt – die
Website bleibt dadurch schnell.

### Neuigkeiten posten

Im Portal gibt es den Bereich **„📣 Neuigkeiten posten"**: Titel,
Nachricht und wenn du magst ein Bild – auf „Beitrag veröffentlichen"
klicken, und der Beitrag steht mit Datum und Uhrzeit ganz oben auf der
Seite `/neuigkeiten.html`. Eine Leerzeile im Text beginnt einen neuen
Absatz. Vorhandene Beiträge lassen sich darunter jederzeit bearbeiten oder
löschen.

Diese Beiträge brauchen kein „Jetzt veröffentlichen" – sie sind mit dem
Klick sofort live.

### Galerie pflegen

Unter **„🖼️ Galerie – Ordner & Bilder"** steht die ganze Ordnerstruktur.
Dort lässt sich ein Ordner anlegen, umbenennen oder löschen und – wichtig –
es können **mehrere Bilder gleichzeitig** hochgeladen werden: auf „📷 Bilder
auswählen" klicken, im Dateifenster mit `Strg` (Mac: `Cmd`) oder
`Umschalt` mehrere Fotos markieren, öffnen. Der Fortschritt wird angezeigt.

Unter jedem Bild gibt es ein Textfeld; dieser Text erscheint auf der
Website unter dem Bild. Nach dem Tippen einmal „Ordner speichern" klicken –
Name, Beschreibung und alle Texte des Ordners werden zusammen übernommen.
Hochgeladene und gelöschte Bilder werden sofort gespeichert.

Das **Passwort** lässt sich im Portal unter „Passwort ändern“ wechseln; es
gilt sofort.

### Passwort vergessen? Wiederherstellungs-Codes

Damit ein vergessenes Passwort kein Fall für die Kommandozeile wird, gibt
es im Portal den Abschnitt **„🆘 Wiederherstellungs-Codes“**. Ein Klick auf
„Neue Codes erzeugen“ liefert acht Codes wie `HKK55-8HAJ6-KDCJ8`:

1. Codes ausdrucken oder als Datei speichern (sie werden **nur dieses eine
   Mal** angezeigt) und zu den wichtigen Unterlagen legen
2. Ist das Passwort später weg: auf der Anmeldeseite auf „Passwort
   vergessen?“ klicken, einen Code eingeben, neues Passwort vergeben
3. Jeder Code gilt genau einmal – wie viele noch übrig sind, steht im
   Portal. Bei den letzten Codes einfach einen neuen Satz erzeugen (alte
   gelten dann nicht mehr)

Beim Eingeben sind Groß-/Kleinschreibung und die Trennstriche egal.
Nach fünf Fehlversuchen greift dieselbe Sperre wie bei der Anmeldung.

Sind auch die Codes nicht mehr auffindbar, hilft der Weg über den Pi:

```bash
sudo bash deploy/passwort-setzen.sh               # nur das Passwort neu setzen
sudo bash deploy/passwort-setzen.sh --neue-codes  # dazu einen frischen Satz Codes
```

Vorhandene Codes bleiben beim Passwortwechsel gültig – sie hängen nicht am
Passwort.

---

## Feste Adresse im Heimnetz

Damit sich die IP-Adresse des Pi nicht ändert, im Router eine feste
IP-Adresse für den Pi vergeben (FRITZ!Box: *Heimnetz → Netzwerk → Pi
bearbeiten → „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse
zuweisen“*).

Der Name `raspberrypi.local` funktioniert unter Windows, macOS, iPhone und
Android ohne weitere Einstellungen, solange der Pi im selben Netz hängt.

---

## Alltag

| Aufgabe | Befehl auf dem Pi |
|---|---|
| Läuft alles? | `sudo systemctl status mellis-website` |
| Protokoll mitlesen | `sudo journalctl -u mellis-website -f` |
| Neu starten | `sudo systemctl restart mellis-website` |
| Neue Version von GitHub holen | `bash deploy/update.sh` |
| Portal-Passwort neu setzen | `sudo bash deploy/passwort-setzen.sh` |
| Neue Wiederherstellungs-Codes | `sudo bash deploy/passwort-setzen.sh --neue-codes` |

Den Pi einfach ausschalten ist unproblematisch – der Dienst startet beim
nächsten Einschalten von selbst wieder.

---

## Wo liegen die Daten?

Alles, was über das Portal gepflegt wird, liegt **außerhalb** des
Website-Ordners und übersteht daher jedes Update:

```
/var/lib/mellis-website/
├── inhalte.json          ← alle Texte, Zeiten, Kontaktdaten
├── beitraege.json        ← die Neuigkeiten-Beiträge
├── galerie.json          ← die Galerie-Ordner mit ihren Bildern
├── zugang.json           ← Prüfwerte von Passwort und Wiederherstellungs-Codes
│                           (beides kein Klartext)
├── bilder/               ← über das Portal hochgeladene Bilder
└── sicherungen/          ← die letzten 30 Stände beider JSON-Dateien
```

Vor jedem Veröffentlichen legt der Server automatisch eine Sicherung an.
Etwas versehentlich überschrieben? Dann die gewünschte Sicherung
zurückkopieren:

```bash
ls /var/lib/mellis-website/sicherungen/
sudo cp /var/lib/mellis-website/sicherungen/inhalte-2026-07-26T10-15-00.json \
        /var/lib/mellis-website/inhalte.json
```

### Sicherungskopie auf den eigenen Rechner

```bash
scp -r pi@raspberrypi.local:/var/lib/mellis-website ./mellis-sicherung
```

---

## Fehlersuche

**Die Seite ist nicht erreichbar**

```bash
sudo systemctl status mellis-website
sudo journalctl -u mellis-website -n 50 --no-pager
```

**„Port 80 ist bereits belegt“** – dann läuft auf dem Pi schon ein anderer
Webserver. Wer es ist, verrät:

```bash
sudo ss -ltnp | grep ':80 '
```

Häufige Kandidaten: `lighttpd` (gehört meist zu **Pi-hole**), `apache2`,
`nginx`. Es gibt zwei Wege:

*Weg 1 – die Website auf einen anderen Port legen.* Der einfachste Weg,
wenn das andere Programm gebraucht wird:

```bash
sudo MELLIS_PORT=8080 bash deploy/install.sh
# → http://raspberrypi.local:8080/
# → Portal: http://raspberrypi.local:8080/admin.html
```

Der Port gehört dann zur Adresse dazu – ein Lesezeichen im Browser nimmt
einem das Tippen ab.

*Weg 2 – das andere Programm abschalten.* Nur, wenn es wirklich nicht
mehr gebraucht wird (`PROGRAMM` durch den gefundenen Namen ersetzen):

```bash
sudo systemctl disable --now PROGRAMM
sudo bash deploy/install.sh
```

Bei Pi-hole besser Weg 1 wählen – ohne `lighttpd` fehlt dort die
Weboberfläche. (Alternativ lässt sich Pi-hole selbst auf einen anderen
Port legen: in `/etc/lighttpd/lighttpd.conf` `server.port` ändern.)

**Portal meldet „Der Server ist nicht erreichbar“** – der Dienst läuft
nicht oder wurde neu gestartet. Nach einem Neustart ist eine erneute
Anmeldung nötig.

**Ein Knopf im Portal tut gar nichts** – dann hält der Browser noch eine
alte Fassung der Skripte fest. Einmal mit `Strg` + `Umschalt` + `R`
(Mac: `Cmd` + `Umschalt` + `R`) neu laden. Seiten, Skripte und Stile
werden inzwischen bei jedem Aufruf beim Server geprüft, damit das nach
einem Update nicht mehr vorkommt.

**`raspberrypi.local` wird nicht gefunden** – stattdessen die IP-Adresse
nutzen, oder auf dem Pi `sudo apt install -y avahi-daemon` nachinstallieren.

---

## Später: ins Internet stellen

Der Server ist darauf vorbereitet – es fehlt nur der Weg von außen zum Pi.
Zwei bewährte Möglichkeiten:

**a) Cloudflare Tunnel (empfohlen, keine Portfreigabe nötig)**

Funktioniert auch bei DS-Lite-Anschlüssen ohne eigene IPv4-Adresse,
verbirgt die Heim-IP und bringt HTTPS gratis mit. Auf dem Pi
`cloudflared` installieren, einen Tunnel anlegen und ihn auf
`http://localhost:80` zeigen lassen.

**b) Eigene Domain mit Portfreigabe**

Im Router die Ports 80 und 443 auf den Pi weiterleiten, die Domain per
DynDNS aktuell halten und mit `certbot` ein Let's-Encrypt-Zertifikat
holen – entweder direkt oder mit nginx davor.

In beiden Fällen sollte das Portal per HTTPS laufen. Der Server kann das
auch selbst, wenn Zertifikat und Schlüssel hinterlegt werden – dazu in
`/etc/systemd/system/mellis-website.service` ergänzen:

```ini
Environment=MELLIS_TLS_CERT=/pfad/zum/fullchain.pem
Environment=MELLIS_TLS_KEY=/pfad/zum/privkey.pem
```

Danach `sudo systemctl daemon-reload && sudo systemctl restart mellis-website`.

> **Hinweis zum Heimnetz-Betrieb:** Ohne HTTPS wird das Portal-Passwort
> unverschlüsselt durchs eigene WLAN geschickt. Im privaten Heimnetz ist
> das vertretbar; sobald die Website öffentlich erreichbar ist, sollte
> HTTPS eingerichtet sein.
