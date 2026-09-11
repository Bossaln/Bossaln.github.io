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
Bewertungen, Galerie, Veröffentlichen und Passwort ändern. **Bilder** landen
dabei direkt auf dem Pi und werden nicht in die Inhaltsdatei gepackt – die
Website bleibt dadurch schnell.

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

## E-Mail-Versand für das Kontaktformular

Ohne Zugangsdaten öffnet das Kontaktformular wie früher das E-Mail-Programm
der Besucher. Damit der Pi die Anfragen selbst verschickt, braucht er ein
Postfach. Die Zugangsdaten kommen in eine eigene Datei, die nur root lesen
darf – nicht in die Dienstdatei:

```bash
sudo install -m 600 /dev/null /etc/mellis-website.env
sudo nano /etc/mellis-website.env
```

Inhalt (Beispiel für einen Anbieter mit STARTTLS auf Port 587):

```ini
MELLIS_SMTP_HOST=smtp.euer-anbieter.de
MELLIS_SMTP_PORT=587
MELLIS_SMTP_USER=website@mellis-krabbelzwerge.de
MELLIS_SMTP_PASS=hier-das-passwort
MELLIS_SMTP_VON=website@mellis-krabbelzwerge.de
MELLIS_KONTAKT_AN=luca.klemme@icloud.com
```

Danach den Dienst neu starten:

```bash
sudo systemctl daemon-reload
sudo systemctl restart mellis-website
```

Ob es klappt, zeigt das Protokoll: `journalctl -u mellis-website -f`.
Dort steht nach jeder Anfrage entweder „Kontaktanfrage gesendet an …" oder
„Kontaktanfrage fehlgeschlagen: …" samt Grund. Passwörter tauchen im
Protokoll nie auf.

**Hinweis zu iCloud und Gmail:** Beide brauchen ein *app-spezifisches
Passwort*, das normale Kontopasswort wird abgelehnt. Bei iCloud lautet der
Server `smtp.mail.me.com` (Port 587); als Absender muss die eigene
iCloud-Adresse eingetragen sein.


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
| Ist die Seite online? | `bash deploy/domain-pruefen.sh` |
| Öffentliche Adresse anzeigen | `mellis-tunnel-adresse` |
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
├── bewertungen.json      ← die Bewertungen der Besucher
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

## Ins Internet stellen – unter pexel.space

**Eingerichtet: Cloudflare-Tunnel auf die eigene Domain.**

Ein zweiter Dienst, `mellis-tunnel`, baut vom Pi aus eine Verbindung zu
Cloudflare auf und reicht Besucher von dort an `http://127.0.0.1:8080`
weiter. Vorteile gegenüber einer Portfreigabe: keine Änderung am Router
nötig, die Heim-IP-Adresse bleibt verborgen, HTTPS bringt Cloudflare
gratis mit – und es funktioniert auch an DS-Lite-Anschlüssen ohne eigene
IPv4-Adresse.

### Der Weg in drei Schritten

**1. Domain bei Cloudflare anlegen** (im Browser, einmalig)

* Kostenloses Konto auf [dash.cloudflare.com](https://dash.cloudflare.com)
* „Add a domain“ → `pexel.space` → Tarif **Free**
* Cloudflare zeigt danach **zwei Nameserver** an, etwa
  `dana.ns.cloudflare.com` und `rick.ns.cloudflare.com`

**2. Nameserver beim Registrar umstellen**

`pexel.space` liegt bei **Strato**. Dort im Kundenbereich unter
*Domainverwaltung → pexel.space → Nameserver* die beiden Cloudflare-Namen
eintragen und die alten (`shades12.rzone.de`, `docks10.rzone.de`)
ersetzen. Die Umstellung braucht meist ein paar Stunden, gelegentlich bis
zu 24. Cloudflare schickt eine E-Mail, sobald die Domain **„Active“** ist.

**3. Tunnel auf dem Pi einrichten** (einmalig, ein Befehl)

```bash
sudo bash deploy/domain-einrichten.sh pexel.space
```

Das Skript

1. meldet den Pi bei Cloudflare an – dazu erscheint ein Link, der auf
   irgendeinem Gerät mit Browser geöffnet wird (Handy genügt); dort die
   Domain `pexel.space` auswählen,
2. legt den benannten Tunnel `mellis` an und hinterlegt seinen Schlüssel
   unter `/etc/cloudflared/`,
3. schreibt den Wegweiser `/etc/cloudflared/config.yml`
   (`pexel.space` und `www.pexel.space` → Website auf Port 8080),
4. trägt bei Cloudflare die passenden DNS-Einträge ein,
5. stellt den Dienst `mellis-tunnel` von der Zufallsadresse auf die feste
   Adresse um und startet ihn.

Der dritte Schritt darf **vor oder nach** dem Nameserver-Wechsel laufen –
und beliebig oft. Läuft er vorher, steht alles bereit und die Seite geht
in dem Moment online, in dem Cloudflare die Domain übernimmt.

> Nur wenn `pexel.space` im Cloudflare-Konto noch gar nicht angelegt ist,
> kann das Skript die DNS-Einträge nicht setzen. Es sagt das deutlich –
> dann Schritt 1 nachholen und das Skript noch einmal starten.

### Läuft es?

```bash
bash deploy/domain-pruefen.sh
```

Die Prüfung geht die ganze Kette durch – Website auf dem Pi, Tunnel,
Nameserver, DNS-Einträge, Aufruf von außen – und sagt bei jedem Punkt
✓ oder ✗ samt Grund. Solange die Nameserver noch bei Strato stehen,
meldet Punkt 3 und 5 ein ✗; das ist genau richtig und erledigt sich mit
dem Wechsel von selbst.

Die aktuelle Adresse zeigt jederzeit:

```bash
mellis-tunnel-adresse
```

### Danach im Cloudflare-Dashboard

Zwei Schalter, die dafür sorgen, dass wirklich jeder Besucher verschlüsselt
ankommt (beide unter der Domain `pexel.space`):

| Wo | Einstellung |
|---|---|
| SSL/TLS → Overview | Verschlüsselungsmodus **Full** |
| SSL/TLS → Edge Certificates | **Always Use HTTPS** einschalten |
| SSL/TLS → Edge Certificates | **Automatic HTTPS Rewrites** einschalten |

Das Zertifikat für `pexel.space` stellt Cloudflare selbst aus – auf dem Pi
ist nichts zu verlängern und nichts zu warten.

**Wichtig – die Prüfseite abschalten.** Neue Zonen bringen bei Cloudflare oft
den *Bot Fight Mode* mit. Besucher sehen dann kurz „Just a moment …", bevor
die Seite kommt. Für Menschen mit Browser ist das nur eine Verzögerung –
**Suchmaschinen kommen damit aber gar nicht durch**, die Seite taucht bei
Google also nie auf. Deshalb ausschalten:

| Wo | Einstellung |
|---|---|
| Security → Bots | **Bot Fight Mode** → aus |
| Security → Settings | Security Level auf **Medium** (nicht „I'm Under Attack") |

Ob noch eine Prüfseite davorsteht, sagt `bash deploy/domain-pruefen.sh` im
Klartext.

### Was sich sonst ändert

* **`www.pexel.space` leitet auf `pexel.space`** – damit Suchmaschinen die
  Seite nicht doppelt kennen. Die Weiterleitung macht der Pi selbst; er
  erfährt seine Domain über `MELLIS_DOMAIN` in `/etc/mellis-website.env`,
  das vom Einrichtungsskript gesetzt wird.
* **Im Heimnetz bleibt alles wie bisher**: `http://home.local:8080/`
  funktioniert weiter, unabhängig vom Tunnel.
* **Das Protokoll zeigt jetzt die echte Besucher-Adresse.** Ohne diesen
  Zusatz sähe hinter dem Tunnel jeder Besucher wie `127.0.0.1` aus – fünf
  Fehlversuche irgendwo auf der Welt hätten dann alle anderen mitgesperrt.

### Alltag mit dem Tunnel

```bash
sudo systemctl status mellis-tunnel     # läuft er?
sudo systemctl restart mellis-tunnel    # neu starten (Adresse bleibt!)
sudo systemctl stop mellis-tunnel       # Website wieder nur im Heimnetz
sudo systemctl disable mellis-tunnel    # auch nach Reboot aus
journalctl -u mellis-tunnel -f          # Protokoll mitlesen
```

> **Hinweis zum Passwort:** Über den Tunnel läuft alles per HTTPS, das
> Portal-Passwort geht also verschlüsselt raus. Ruft man das Portal
> dagegen direkt im Heimnetz über `http://<Pi-IP>:8080` auf, ist die
> Verbindung unverschlüsselt – im eigenen WLAN vertretbar, aber der Weg
> über `https://pexel.space` ist auch von zu Hause aus der sicherere.
>
> Da das Portal aus dem Internet erreichbar ist, sollte das Passwort lang
> und einzigartig sein – notfalls neu setzen mit
> `sudo bash deploy/passwort-setzen.sh`.

### Fehlersuche

**`domain-pruefen.sh` meldet HTTP 502 oder 530** – Cloudflare erreicht den
Pi nicht. Meist läuft die Website gerade nicht:
`sudo systemctl status mellis-website`.

**Die Seite zeigt eine Cloudflare-Fehlerseite „Host Error“** – der Tunnel
steht, aber der Wegweiser zeigt auf den falschen Port. Prüfen mit
`cat /etc/cloudflared/config.yml`; der Port dort muss zu
`Environment=MELLIS_PORT=` in `/etc/systemd/system/mellis-website.service`
passen. Danach `sudo bash deploy/domain-einrichten.sh pexel.space`.

**Alles noch einmal von vorn** – Tunnel bei Cloudflare löschen und neu
aufsetzen:

```bash
sudo systemctl stop mellis-tunnel
sudo cloudflared --origincert /etc/cloudflared/cert.pem tunnel delete mellis
sudo bash deploy/domain-einrichten.sh pexel.space
```

### Alternative: eigene Domain mit Portfreigabe

Statt des Tunnels ginge auch: im Router die Ports 80 und 443 auf den Pi
weiterleiten, die Domain per DynDNS aktuell halten und mit `certbot` ein
Let's-Encrypt-Zertifikat holen. Nur bei dieser Variante muss man sich
selbst um HTTPS kümmern. Der Server kann HTTPS auch direkt, wenn
Zertifikat und Schlüssel hinterlegt werden – dazu in
`/etc/systemd/system/mellis-website.service` ergänzen:

```ini
Environment=MELLIS_TLS_CERT=/pfad/zum/fullchain.pem
Environment=MELLIS_TLS_KEY=/pfad/zum/privkey.pem
```

Danach `sudo systemctl daemon-reload && sudo systemctl restart mellis-website`.

Auf dem Pi belegt allerdings **Pi-hole** die Ports 80 und 443 – dieser Weg
wäre also erst nach einer Umverteilung der Ports gangbar. Der Tunnel
umgeht das Problem vollständig; das ist der Grund für die obige Wahl.

---

## Bei Google auftauchen

**Kurz: erst die endgültige Domain, dann Google.**

Solange die Seite unter einer Probe-Adresse läuft, wäre eine Aufnahme in den
Index schädlich. Die Texte stünden doppelt in der Suche, Google müsste raten,
welche Adresse die richtige ist – und eine Adresse wieder *aus* dem Index zu
bekommen dauert Wochen, während das Hineinkommen Tage dauert.

Deshalb hält sich der Server im Probebetrieb von selbst zurück:

| | Probebetrieb | Freigegeben |
|---|---|---|
| `robots.txt` | `Disallow: /` | normale Regeln + Verweis auf die Sitemap |
| Kopfzeile jeder Seite | `X-Robots-Tag: noindex, nofollow` | keine |
| `/sitemap.xml` | 404 | alle öffentlichen Seiten mit Änderungsdatum |

Gesteuert wird das über **eine** Zeile in `/etc/mellis-website.env`:

```ini
MELLIS_SUCHMASCHINEN=nein
```

Das Verwaltungs-Portal `admin.html` bleibt in **beiden** Fällen draußen.

### Wenn die endgültige Domain steht

**1. Domain umstellen** – genau wie beim ersten Mal:

```bash
sudo bash deploy/domain-einrichten.sh mellis-krabbelzwerge.de
bash deploy/domain-pruefen.sh
```

**2. Für Suchmaschinen freigeben**

```bash
sudo sed -i 's/^MELLIS_SUCHMASCHINEN=.*/MELLIS_SUCHMASCHINEN=ja/' /etc/mellis-website.env
sudo systemctl restart mellis-website
```

Prüfen, ob es gegriffen hat – die erste Zeile darf **nicht** mehr
„Disallow: /" enthalten, die zweite muss eine Seitenliste zeigen:

```bash
curl https://mellis-krabbelzwerge.de/robots.txt
curl https://mellis-krabbelzwerge.de/sitemap.xml
```

**3. Die alte Probe-Adresse abschalten.** Sonst steht dieselbe Seite unter
zwei Namen im Netz. Im Wegweiser `/etc/cloudflared/config.yml` bleibt nur
noch die echte Domain übrig – das erledigt Schritt 1 automatisch, weil er
die Datei neu schreibt.

**4. Google Search Console** – [search.google.com/search-console](https://search.google.com/search-console)

* „Property hinzufügen" → **Domain** (nicht „URL-Präfix")
* Google nennt einen TXT-Eintrag. Den im Cloudflare-Dashboard unter
  *DNS → Add record* als `TXT` mit Namen `@` eintragen. Das geht sofort,
  weil die Domain schon bei Cloudflare liegt.
* Nach der Bestätigung: *Sitemaps* → `sitemap.xml` eintragen
* *URL-Prüfung* → Startseite eingeben → „Indexierung beantragen"

**5. Google Unternehmensprofil** – [business.google.com](https://business.google.com)

Für eine Großtagespflege ist das **wichtiger als alles andere**: Wer „Kita
Essen Stoppenberg" sucht, bekommt zuerst die Karte mit den Einträgen aus dem
Unternehmensprofil, erst darunter normale Treffer. Eintragen: Name, Adresse,
Telefon, Öffnungszeiten, Fotos, Website-Adresse. Google schickt eine Postkarte
mit einem Bestätigungscode an die Adresse.

**Achtung – überall dieselbe Schreibweise.** Name, Adresse und Telefonnummer
müssen im Unternehmensprofil, im Impressum und auf der Kontaktseite Zeichen
für Zeichen gleich stehen. Google gleicht das ab; Abweichungen kosten
Sichtbarkeit.

### Wie lange dauert das?

* Search Console erkennt die Sitemap meist innerhalb von **1–3 Tagen**
* Die ersten Seiten stehen nach **wenigen Tagen bis zwei Wochen** in der Suche
* Das Unternehmensprofil ist nach der Postkarten-Bestätigung (**1–2 Wochen**)
  sofort in der Karte sichtbar

Nachhelfen lässt sich kaum – wer „schnelle Indexierung" verkauft, verkauft
Luft. Was wirklich hilft: ein Eintrag im Unternehmensprofil und Verweise von
Seiten, die es schon gibt (Stadtportal, Träger, Elternvereine, Facebook).

### Noch nicht eingebaut

Zwei Dinge würden die Darstellung verbessern, brauchen aber die endgültige
Domain, weil dort vollständige Adressen hineingehören:

* **Vorschaubild beim Teilen** (`og:`-Angaben) – bestimmt, wie die Seite in
  WhatsApp, Facebook und Signal aussieht. Ohne das erscheint nur der nackte
  Link.
* **Strukturierte Daten** (`ChildCare` als JSON-LD) – liefert Google Adresse,
  Öffnungszeiten und Telefonnummer maschinenlesbar mit.

---

## Protokolle nach 30 Tagen löschen (Datenschutz)

Die Datenschutzerklärung sagt zu, dass Protokolleinträge – darunter
IP-Adressen fehlgeschlagener Portal-Anmeldungen – spätestens nach 30 Tagen
gelöscht werden. Neue Installationen richten das automatisch ein. Auf einem
bereits laufenden Pi einmalig nachholen:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=30day\n' | sudo tee /etc/systemd/journald.conf.d/50-mellis-website.conf
sudo systemctl restart systemd-journald
sudo journalctl --vacuum-time=30d      # ältere Einträge sofort entfernen
```
