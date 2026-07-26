# Melli's Krabbelzwerge – Website

Website der Großtagespflege **Melli's Krabbelzwerge** in Essen-Stoppenberg.

> „Alles was ein Kind braucht, um glücklich zu sein."

Betrieben von Melanie Graw und Ivonne Braß · Im Looscheid 82, 45141 Essen
· www.mellis-krabbelzwerge.de

## Seiten

| Datei | Inhalt |
|---|---|
| `index.html` | Startseite mit Hero, Vorteilen, Zahlen, Betreuungszeiten |
| `ueber-uns.html` | Team, Werte und Vorstellung der Großtagespflege |
| `tagesablauf.html` | Tagesablauf als Zeitstrahl + FAQ |
| `galerie.html` | Galerie (Platzhalter-Kacheln, bis echte Fotos vorliegen) |
| `neuigkeiten.html` | Neuigkeiten als Beitragsstrom (aus dem Portal gepflegt) |
| `kontakt.html` | Kontaktformular mit Validierung, Adresse, Karte |
| `impressum.html` | Impressum (Mustertext mit Platzhaltern) |
| `datenschutz.html` | Datenschutzerklärung (Mustertext mit Platzhaltern) |

## Technik

- Reines HTML, CSS und JavaScript – kein Framework, kein Build-Schritt
- Responsives Design (Mobile-Menü ab 760px Breite)
- JavaScript-Funktionen: Hamburger-Menü, Scroll-Einblendungen, Akkordeons,
  animierte Zähler, „Nach oben"-Button, Formular-Validierung
- Das Kontaktformular öffnet aktuell eine vorbefüllte E-Mail (`mailto:`),
  da die Seite statisch ist. Für echten Versand einen Formulardienst
  (z. B. Formspree) oder ein eigenes Backend in `js/main.js` einbinden.

## Betrieb auf dem eigenen Server (Raspberry Pi)

Die Website kann als echter Webserver auf einem Raspberry Pi laufen –
dann speichert das Portal Änderungen direkt auf dem Server und sie sind
sofort für alle Besucher sichtbar. Vollständige Anleitung:
[`deploy/README.md`](deploy/README.md).

```bash
sudo bash deploy/install.sh     # einmalig einrichten
bash deploy/update.sh           # später neue Version holen
```

Der Server (`server/server.js`) braucht nur Node.js ab Version 16 und
keinerlei zusätzliche Pakete. Er liefert die Website aus (mit gzip,
Zwischenspeicher-Kennzeichen und Adressen ohne `.html`) und stellt dem
Portal eine kleine Schnittstelle bereit:

| Aufruf | Zweck |
|---|---|
| `GET /api/status` | Läuft der Server? Besteht eine Sitzung? |
| `POST /api/anmelden` | Passwortprüfung auf dem Server, setzt einen HttpOnly-Sitzungskeks |
| `POST /api/abmelden` | Sitzung beenden |
| `POST /api/veroeffentlichen` | Inhalte speichern (nach Anmeldung) |
| `POST /api/beitraege` | Neuigkeiten speichern (nach Anmeldung) |
| `POST /api/bild` | Bild als Datei ablegen (nach Anmeldung) |
| `POST /api/passwort` | Portal-Passwort ändern (nach Anmeldung) |

Alles, was das Portal pflegt, liegt in `/var/lib/mellis-website`
(Inhalte, Neuigkeiten, Bilder, Passwort-Prüfwert, die letzten 30
Sicherungen) und bleibt bei Updates unangetastet. Bringt ein Update neue
Textfelder mit (z. B. eine neue Seite), ergänzt der Server sie beim Start
automatisch, ohne gepflegte Texte zu überschreiben. Die Zugangsdatei wird
im Server-Betrieb nicht mehr ausgeliefert.

## Neuigkeiten (`neuigkeiten.html`)

Ein Beitragsstrom – der neueste oben, jeder Beitrag mit Titel, Nachricht,
optionalem Bild und Zeitstempel („vor 3 Tagen" plus genaues Datum).
Geschrieben werden sie im Portal unter „📣 Neuigkeiten posten":
Titel, Nachricht, wenn gewünscht ein Bild – veröffentlichen, fertig.
Vorhandene Beiträge lassen sich dort bearbeiten und löschen.

Gespeichert wird in `daten/beitraege.json`:

```json
[{ "id": "b-…", "titel": "…", "text": "…", "bild": "bilder/…jpg", "zeit": "2026-07-26T18:30:00.000Z" }]
```

Texte werden auf der Seite als reiner Text eingesetzt (kein `innerHTML`),
Leerzeilen werden zu Absätzen. Bilder von gelöschten Beiträgen räumt der
Server nach einer Stunde selbst auf.

## Verwaltungs-Portal (`admin.html`)

Unter `/admin.html` (Footer-Link „Portal") lässt sich praktisch die ganze
Website ohne Programmierkenntnisse bearbeiten: Betreuungszeiten,
Kontaktdaten, alle Fotos inkl. Logo, Neuigkeiten-Beiträge sowie sämtliche
Texte aller Seiten (über 170 Felder, nach Seiten gruppiert). Die editierbaren Stellen sind im
HTML mit `data-cms`-Attributen markiert; `daten/portal-schema.json`
beschreibt die Felder für das Portal. Neue editierbare Stellen können durch
Markieren eines Elements (`data-cms="schluessel"`) plus Eintrag in
`inhalte.json`/`portal-schema.json` ergänzt werden.

**Ablauf auf dem eigenen Server (Raspberry Pi):** Änderungen im Portal →
„Vorschau speichern" (nur im eigenen Browser sichtbar) → „Jetzt
veröffentlichen" schreibt sie direkt auf die Website. Fertig – alle
Besucher sehen sie sofort. Bilder werden dabei als Datei auf dem Server
abgelegt, nicht in die JSON gepackt.

**Ablauf bei statischem Hosting (GitHub Pages):** Änderungen im Portal →
„Vorschau speichern" → „Veröffentlichen" lädt eine `inhalte.json`
herunter → diese Datei in den Ordner `daten/` der Website hochladen
(ersetzen). Erst dann sehen alle Besucher die Änderungen.

Das Portal erkennt selbst, welcher Fall vorliegt (über `api/status`), und
passt Texte und Schaltflächen entsprechend an.

**Sicherheit:**

- Das Passwort wird niemals gespeichert – in `daten/zugang.json` liegt nur
  ein PBKDF2-SHA256-Hash (310.000 Iterationen, zufälliges Salt).
- Nach 5 Fehlversuchen wird die Anmeldung exponentiell lange gesperrt;
  die Sitzung läuft nach 30 Minuten Inaktivität ab.
- Die Portal-Seite hat eine strikte Content-Security-Policy und ist für
  Suchmaschinen gesperrt (`noindex`).
- Im Server-Betrieb prüft der Server das Passwort (die Zugangsdatei wird
  gar nicht erst ausgeliefert), begrenzt Fehlversuche pro IP-Adresse und
  vergibt eine Sitzung als HttpOnly-Keks mit `SameSite=Strict`.
  Hochgeladene Inhalte werden geprüft, in der Größe begrenzt und vor dem
  Überschreiben gesichert.
- Bei statischem Hosting schützt das Passwort nur den Bearbeitungszugang:
  Die öffentliche Website kann ohne Zugriff auf den Webspace/das
  Repository nicht verändert werden – auch nicht über das Portal.

**Passwort ändern:** im Portal unter „Passwort ändern". Im Server-Betrieb
gilt das neue Passwort sofort; bei statischem Hosting wird eine neue
`zugang.json` erzeugt, die in `daten/` hochgeladen werden muss.
Passwort vergessen? Auf dem Pi hilft `sudo bash deploy/passwort-setzen.sh`,
sonst eine neue Datei per Kommandozeile erzeugen:

```bash
node -e "const c=require('crypto');const pw=process.argv[1];const salz=c.randomBytes(16).toString('hex');const it=310000;const hash=c.pbkdf2Sync(pw,Buffer.from(salz,'hex'),it,32,'sha256').toString('hex');console.log(JSON.stringify({algorithmus:'PBKDF2-SHA256',iterationen:it,salz,hash},null,2))" 'NEUES-PASSWORT'
```

## Lokal ansehen

Einfach `index.html` im Browser öffnen – oder einen kleinen Server starten:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Mit dem eigenen Server (inklusive Portal-Schnittstelle) testen:

```bash
MELLIS_PORT=8000 MELLIS_DATEN=/tmp/mellis-daten node server/server.js
# → http://localhost:8000
```

## Vor dem Livegang anpassen

- [ ] Echte Telefonnummer und E-Mail-Adresse eintragen (Platzhalter: `0201 / 00 00 00 00`, `info@mellis-krabbelzwerge.de`)
- [ ] Kartenausschnitt in `kontakt.html` auf die exakten Koordinaten setzen (aktuell grob auf Stoppenberg zentriert)
- [ ] Fotos in besserer Auflösung einsetzen – die aktuellen Bilder (`assets/img/team.jpg`, `spielzimmer.jpg`, `garten.jpg`, `raum.jpg`) stammen aus dem eingescannten Flyer
- [ ] Betreuungszeiten prüfen (aktuell: Mo–Do 7:30–15:30, Fr 7:30–14:30 – nicht aus dem Flyer belegt)
