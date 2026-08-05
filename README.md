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
| `galerie.html` | Galerie in Ordnern, mit Großansicht (aus dem Portal gepflegt) |
| `konzept.html` | Das pädagogische Konzept in voller Länge, mit anklickbarem Inhaltsverzeichnis |
| `neuigkeiten.html` | Neuigkeiten als Beitragsstrom (aus dem Portal gepflegt, nicht mehr im Menü) |
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

### Skripte

| Datei | Zweck |
|---|---|
| `js/vendor/motion.min.js` | [motion.dev](https://motion.dev) in der „mini"-Bauform (12 KB, MIT-Lizenz). Treibt alle Animationen. Liegt lokal – kein CDN, keine fremde Verbindung. |
| `js/cms.js` | Setzt die im Portal gepflegten Texte und Bilder ein (mit Filter gegen eingeschleustes HTML) |
| `js/main.js` | Bedienung und Bewegung: Navigation, Akkordeon, Formular, Einblendungen, Zähler, Schreibmaschine |
| `js/galerie.js`, `js/neuigkeiten.js` | Nur auf den jeweiligen Seiten |
| `js/admin.js` | Verwaltungs-Portal |

### Schriften

„Baloo 2" und „Nunito" liegen als variable Schriften in `assets/fonts/`
und kommen vom eigenen Server – **nicht** von Google Fonts. Das ist
schneller (zwei Dateien statt sieben, keine fremde Verbindung im
kritischen Ladepfad) und vermeidet die Übermittlung der Besucher-IP an
Google. Die Datenschutzerklärung ist entsprechend formuliert; wer die
Schriften wieder extern einbindet, muss sie zurückändern.

### Animationen

Alle Bewegungen laufen über `Motion.animate()` und damit über die
Web-Animations-API des Browsers: die Animation wird einmal übergeben und
danach von der Grafikeinheit berechnet. Pro Einzelbild läuft kein
JavaScript mehr – das hält die Seite auch auf schwacher Hardware flüssig.

Zwei Dinge sind dafür wichtig zu wissen:

- Im `<head>` jeder Seite steht ein kurzes Startskript, das die Klassen
  `js` und `bewegung` an `<html>` setzt, **bevor** der Browser etwas
  zeichnet. Nur mit `bewegung` starten Elemente unsichtbar. Fehlt das
  Skript, ist von Anfang an alles sichtbar – nichts kann hängen bleiben.
- Dieses Startskript ist in der Content-Security-Policy über seinen
  Prüfwert (Hash) erlaubt. **Wird es geändert, muss der Hash an drei
  Stellen mitgeändert werden:** im `<meta>`-Tag jeder HTML-Datei und in
  `START_SKRIPT_HASH` in `server/server.js`. Den passenden Wert nennt der
  Browser in der Fehlerkonsole, oder:

  ```bash
  node -e "const c=require('crypto');console.log('sha256-'+c.createHash('sha256').update(process.argv[1]).digest('base64'))" 'INHALT-DES-SKRIPTS'
  ```

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
keinerlei zusätzliche Pakete. Er liefert die Website aus und stellt dem
Portal eine kleine Schnittstelle bereit.

Beim Ausliefern:

- **Brotli** (mit gzip als Rückfallebene). Das Ergebnis wird im Speicher
  behalten, solange sich die Datei nicht ändert – sonst würde der Pi jede
  Seite bei jedem Aufruf neu packen.
- **ETag und `no-cache`** für Seiten, Skripte, Stile und Daten: der Browser
  fragt jedes Mal nach, bekommt bei unveränderter Datei aber nur ein
  knappes „unverändert" (304) statt der ganzen Datei zurück. Nach einem
  Update gilt sofort die neue Fassung.
- **Ein Jahr Zwischenspeicher** für Schriften, eine Woche für hochgeladene
  Bilder (deren Dateiname enthält einen Zeitstempel, dieselbe Adresse zeigt
  also nie auf ein anderes Bild).
- Sicherheits-Kopfzeilen: Content-Security-Policy, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`; bei HTTPS
  zusätzlich HSTS.
- Adressen ohne `.html` (z. B. `/kontakt`).

Die Schnittstelle:

| Aufruf | Zweck |
|---|---|
| `GET /api/status` | Läuft der Server? Besteht eine Sitzung? |
| `POST /api/anmelden` | Passwortprüfung auf dem Server, setzt einen HttpOnly-Sitzungskeks |
| `POST /api/abmelden` | Sitzung beenden |
| `POST /api/veroeffentlichen` | Inhalte speichern (nach Anmeldung) |
| `POST /api/beitraege` | Neuigkeiten speichern (nach Anmeldung) |
| `POST /api/galerie` | Galerie-Ordner speichern (nach Anmeldung) |
| `POST /api/bild` | Bild als Datei ablegen (nach Anmeldung) |
| `POST /api/passwort` | Portal-Passwort ändern (nach Anmeldung) |
| `POST /api/wiederherstellungscodes` | Neuen Satz Wiederherstellungs-Codes erzeugen (nach Anmeldung) |
| `POST /api/zuruecksetzen` | Passwort mit einem Wiederherstellungs-Code neu setzen |

Alles, was das Portal pflegt, liegt in `/var/lib/mellis-website`
(Inhalte, Neuigkeiten, Bilder, Passwort-Prüfwert, die letzten 30
Sicherungen) und bleibt bei Updates unangetastet. Bringt ein Update neue
Textfelder mit (z. B. eine neue Seite), ergänzt der Server sie beim Start
automatisch, ohne gepflegte Texte zu überschreiben. Die Zugangsdatei wird
im Server-Betrieb nicht mehr ausgeliefert.

## Unser Konzept (`konzept.html`)

Das vollständige pädagogische Konzept „Einmal Kind sein …" auf einer
einzigen Seite. Oben steht das Inhaltsverzeichnis; jeder Eintrag ist ein
Sprungziel (`#anker`) **auf derselben Seite** – es öffnet sich also weder
ein neuer Tab noch eine neue Datei, die Seite scrollt nur zum passenden
Kapitel. Am Ende jedes Kapitels führt ein kleiner Verweis zurück zum
Verzeichnis.

Damit die Überschrift beim Anspringen nicht unter dem klebenden Kopf
verschwindet, tragen die Kapitel `scroll-margin-top` (siehe
`.konzept-kapitel` in `css/style.css`). Nur Überschrift und Einleitungssatz
sind über `data-cms` (`konzept_01`, `konzept_02`) austauschbar – der
Konzepttext selbst steht fest im HTML.

Diese Seite hat im Menü den früheren Platz der Neuigkeiten übernommen.

## Neuigkeiten (`neuigkeiten.html`)

Die Seite steht weiterhin unter `/neuigkeiten.html` und wird aus dem Portal
gepflegt, ist aber **nicht mehr im Menü verlinkt** (dort steht jetzt „Unser
Konzept"). Erreichbar ist sie über den Verweis im Portal.

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

## Galerie (`galerie.html`)

Die Galerie ist in **Ordner** unterteilt:

* **Übersicht:** jeder Ordner als Karte mit einer Vorschau-Collage aus bis
  zu vier Bildern, Name, Beschreibung und Bildzahl – ein Blick hinein,
  bevor man ihn öffnet
* **Öffnen:** kurze Aufklapp-Animation, dann eine Bildermauer, deren
  Kachelhöhen dem Seitenverhältnis jedes Bildes folgen (breite Bilder
  flach, hochkant hohe Bilder hoch). Der geöffnete Ordner steht in der
  Adresse (`galerie.html#o-…`), der Zurück-Knopf des Browsers funktioniert.
* **Klick auf ein Bild:** Großansicht mit Text, Pfeilen, Pfeiltasten und
  `Esc`

Gepflegt wird alles im Portal unter „🖼️ Galerie – Ordner & Bilder": Ordner
anlegen, umbenennen, löschen, **mehrere Bilder gleichzeitig** hochladen und
zu jedem Bild einen Text schreiben, der unter dem Bild erscheint.
Gespeichert wird in `daten/galerie.json`:

```json
[{ "id": "o-…", "name": "Sommerfest 2026", "beschreibung": "…", "zeit": "…",
   "bilder": [{ "id": "g-…", "pfad": "bilder/…jpg", "text": "…",
                "breite": 1600, "hoehe": 1067, "zeit": "…" }] }]
```

Die Maße werden beim Hochladen mitgespeichert, damit die Mauer schon vor
dem Laden der Bilder richtig steht. Bilder aus gelöschten Ordnern räumt der
Server nach einer Stunde selbst auf.

## Verwaltungs-Portal (`admin.html`)

Unter `/admin.html` (Footer-Link „Portal") lässt sich ohne
Programmierkenntnisse pflegen, was sich im Alltag ändert:

| Abschnitt | Inhalt |
|---|---|
| 🕐 Betreuungszeiten | Mo – Do, Fr, Sa & So |
| 📞 Kontaktdaten | Telefonnummer, E-Mail-Adresse |
| 💬 Slogan | Slogan auf der Startseite |
| 📣 Neuigkeiten posten | Beiträge mit Titel, Text, Bild |
| 🖼️ Galerie | Ordner anlegen, Bilder hochladen, Bildtexte |
| 💾 Speichern & Veröffentlichen | Zeiten, Kontakt und Slogan live stellen |
| 🔑 Passwort ändern | Portal-Passwort |
| 🆘 Wiederherstellungs-Codes | Codes zum Ausdrucken für ein vergessenes Passwort |

Alle übrigen Seitentexte und die festen Fotos (Logo, Teamfoto, Raumfotos)
werden direkt in den HTML-Dateien bzw. in `daten/inhalte.json` gepflegt –
sie stehen bewusst nicht im Portal, damit es übersichtlich bleibt. Beim
Veröffentlichen bleiben diese Felder unverändert erhalten.

Technisch sind die austauschbaren Stellen im HTML mit `data-cms`-Attributen
markiert und werden von `js/cms.js` aus `daten/inhalte.json` gefüllt. Die
Datei `daten/portal-schema.json` beschreibt diese Felder weiterhin (nützlich
als Übersicht und falls der Texteditor je zurückkehren soll), wird vom
Portal aber nicht mehr gelesen.

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
  die Sitzung läuft nach 30 Minuten Inaktivität ab. Dieselbe Sperre gilt
  für das Zurücksetzen per Wiederherstellungs-Code.
- Die Portal-Seite hat eine strikte Content-Security-Policy, wird nie
  zwischengespeichert (`no-store`) und ist für Suchmaschinen gesperrt
  (`noindex`, zusätzlich über `robots.txt` und `X-Robots-Tag`).
- Im Server-Betrieb prüft der Server das Passwort (die Zugangsdatei wird
  gar nicht erst ausgeliefert), begrenzt Fehlversuche pro IP-Adresse und
  vergibt eine Sitzung als HttpOnly-Keks mit `SameSite=Strict`.
  Hochgeladene Inhalte werden geprüft, in der Größe begrenzt und vor dem
  Überschreiben gesichert.
- Anfragen von fremden Seiten werden über `Sec-Fetch-Site` und `Origin`
  abgewiesen (CSRF). Nicht angemeldete Anfragen an die Schnittstelle sind
  auf 120 pro Minute und IP begrenzt, damit niemand den Server über die
  absichtlich rechenintensive Passwortprüfung lahmlegen kann.
- Hochgeladene Bilder werden an ihren ersten Bytes erkannt, nicht an ihrer
  Beschriftung – eine als `bild.png` getarnte Fremddatei wird abgelehnt.
- Die im Portal gepflegten Texte dürfen an einigen Stellen einfache
  Formatierung enthalten (fett, Zeilenumbruch, Link). `js/cms.js` lässt
  dort nur eine kurze Liste harmloser Elemente und Attribute durch. Selbst
  wer an die Inhaltsdatei käme, könnte darüber kein Skript und keinen
  `javascript:`-Link auf der Seite unterbringen.
- Bei statischem Hosting schützt das Passwort nur den Bearbeitungszugang:
  Die öffentliche Website kann ohne Zugriff auf den Webspace/das
  Repository nicht verändert werden – auch nicht über das Portal.

**Passwort ändern:** im Portal unter „Passwort ändern". Im Server-Betrieb
gilt das neue Passwort sofort; bei statischem Hosting wird eine neue
`zugang.json` erzeugt, die in `daten/` hochgeladen werden muss.

### Passwort vergessen

Dafür gibt es **Wiederherstellungs-Codes**: acht Codes der Form
`XXXXX-XXXXX-XXXXX`, die im Portal unter „🆘 Wiederherstellungs-Codes"
erzeugt und **einmalig** angezeigt werden – ausdrucken und zu den übrigen
wichtigen Unterlagen legen. Ist das Passwort weg, führt auf der
Anmeldeseite „Passwort vergessen?" zu einem Formular: einen Code eingeben,
neues Passwort vergeben, fertig. Jeder Code gilt genau einmal, ein neuer
Satz macht alle alten ungültig.

Technisch:

- In `zugang.json` liegen nur Prüfwerte der Codes (SHA-256 mit Salz),
  niemals die Codes selbst. Das langsame PBKDF2 wie beim Passwort ist hier
  unnötig – ein Code ist gewürfelt und rund 74 Bit lang, nicht kurz und
  ausgedacht. Umgekehrt müsste der Pi sonst bei jedem Versuch acht Mal
  310.000 Runden rechnen.
- Die Codes hängen nicht am Passwort: nach einem Passwortwechsel bleibt der
  Ausdruck gültig.
- Das Zurücksetzen unterliegt derselben Sperre nach fünf Fehlversuchen wie
  die Anmeldung – es ist also kein Umweg an ihr vorbei. Ein erfolgreiches
  Zurücksetzen meldet alle offenen Sitzungen ab.
- Verwechslungsgefährdete Zeichen (`I`, `L`, `O`, `0`, `1`) kommen nicht
  vor; Groß-/Kleinschreibung und Trennstriche sind bei der Eingabe egal.

Sind auch die Codes weg, hilft auf dem Pi:

```bash
sudo bash deploy/passwort-setzen.sh               # Passwort neu, Codes bleiben
sudo bash deploy/passwort-setzen.sh --neue-codes  # zusätzlich neue Codes
```

Ohne Pi lässt sich die Datei auch von Hand erzeugen (dann ohne Codes):

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
