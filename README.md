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
| `kontakt.html` | Kontaktformular mit Validierung, Adresse, Karte |
| `impressum.html` | Impressum (Mustertext mit Platzhaltern) |
| `datenschutz.html` | Datenschutzerklärung (Mustertext mit Platzhaltern) |

## Technik

- Reines HTML, CSS und JavaScript – kein Framework, kein Build-Schritt
- **Keine Drittanbieter-Anfragen beim Seitenaufruf:** Die Schriften (Baloo 2,
  Nunito) liegen als Variable Fonts lokal in `assets/fonts/` (DSGVO-freundlich,
  schneller, kein Schrift-Springen). Die Google-Maps-Karte auf der Kontaktseite
  lädt erst nach Klick (Zwei-Klick-Lösung).
- Responsives Design (Mobile-Menü ab 760px Breite)
- JavaScript-Funktionen: Hamburger-Menü, Scroll-Einblendungen, Akkordeons,
  animierte Zähler, „Nach oben"-Button, Formular-Validierung
- Flüssige Animationen: Es werden nur `transform`/`opacity` animiert
  (Compositor-freundlich, `will-change` nur während der Animation),
  Scroll-Handler laufen über `requestAnimationFrame`, Bilder haben feste
  Maße gegen Layout-Sprünge, und `prefers-reduced-motion` wird respektiert.
- Das Kontaktformular öffnet aktuell eine vorbefüllte E-Mail (`mailto:`),
  da die Seite statisch ist. Für echten Versand einen Formulardienst
  (z. B. Formspree) oder ein eigenes Backend in `js/main.js` einbinden.

## Verwaltungs-Portal (`admin.html`)

Unter `/admin.html` (Footer-Link „Portal") lässt sich praktisch die ganze
Website ohne Programmierkenntnisse bearbeiten: Betreuungszeiten,
Kontaktdaten, alle Fotos inkl. Logo sowie sämtliche Texte aller Seiten.

**Dynamisch:** Das Portal liest die Website bei jeder Anmeldung selbst ein
und erkennt alle bearbeitbaren Stellen (`data-cms`, `data-cms-html`,
`data-cms-bild`) automatisch – inklusive Beschriftung und Seiten-Zuordnung.
Neue editierbare Stellen brauchen nur ein `data-cms="schluessel"`-Attribut
im HTML plus einen Startwert in `inhalte.json`; eine Feldliste muss nicht
gepflegt werden (`daten/portal-schema.json` dient nur noch als Rückfall,
falls das Einlesen fehlschlägt). Eine **Live-Vorschau** im Portal zeigt
jede Seite mit den lokal gespeicherten Änderungen, noch vor der
Veröffentlichung.

**Ablauf:** Änderungen im Portal → „Vorschau speichern" (sofort im eigenen
Browser und in der Live-Vorschau sichtbar) → „Veröffentlichen" lädt eine
`inhalte.json` herunter → diese Datei in den Ordner `daten/` der Website
hochladen (ersetzen). Erst dann sehen alle Besucher die Änderungen.

**Sicherheit:**

- Das Passwort wird niemals gespeichert oder übertragen – in
  `daten/zugang.json` liegt nur ein PBKDF2-SHA256-Hash mit zufälligem Salt
  (Bestandsdatei: 310.000 Iterationen; neu erzeugte Dateien: 600.000,
  entsprechend der OWASP-Empfehlung). Der Vergleich läuft in konstanter
  Zeit, die Zugangsdatei wird vor Verwendung auf Plausibilität geprüft.
- Nach 5 Fehlversuchen wird die Anmeldung exponentiell lange gesperrt
  (zusätzlich im Arbeitsspeicher gespiegelt); Sitzungen enden nach
  30 Minuten Inaktivität, spätestens nach 8 Stunden.
- Maximal strikte Content-Security-Policy: kein Inline-Code, keine
  Drittanbieter, `form-action 'none'`, Trusted Types gegen DOM-XSS.
  Clickjacking-Schutz per Frame-Buster (die CSP-Direktive
  `frame-ancestors` wirkt in Meta-Tags nicht), kein Referrer, für
  Suchmaschinen gesperrt (`noindex`).
- Neue Passwörter müssen mindestens 12 Zeichen lang sein und werden gegen
  typische Schwächen geprüft (Rate-Listen-Wörter, fehlende Vielfalt).
- Auf allen Seiten: Vom Portal verwaltete HTML-Inhalte werden vor dem
  Einfügen bereinigt (Allowlist-Sanitizer in `js/cms.js`), Bildquellen
  sind auf relative Pfade und `data:image/…` beschränkt.
- Wichtig zu wissen: Da die Website statisch gehostet wird, schützt das
  Passwort den Bearbeitungszugang. Die öffentliche Website kann ohne
  Zugriff auf den Webspace/das Repository grundsätzlich nicht verändert
  werden – auch nicht über das Portal. Der Passwort-Hash ist öffentlich
  abrufbar; die tatsächliche Schutzwirkung hängt deshalb von der
  Passwortstärke ab – am besten eine lange Passphrase verwenden.

**Passwort ändern:** im Portal unter „Passwort ändern" eine neue
`zugang.json` erzeugen und in `daten/` hochladen. Passwort vergessen?
Neue Datei per Kommandozeile erzeugen:

```bash
node -e "const c=require('crypto');const pw=process.argv[1];const salz=c.randomBytes(16).toString('hex');const it=600000;const hash=c.pbkdf2Sync(pw,Buffer.from(salz,'hex'),it,32,'sha256').toString('hex');console.log(JSON.stringify({algorithmus:'PBKDF2-SHA256',iterationen:it,salz,hash},null,2))" 'NEUES-PASSWORT'
```

## Lokal ansehen

Einfach `index.html` im Browser öffnen – oder einen kleinen Server starten:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Vor dem Livegang anpassen

- [ ] Echte Telefonnummer und E-Mail-Adresse eintragen (Platzhalter: `0201 / 00 00 00 00`, `info@mellis-krabbelzwerge.de`)
- [ ] Kartenausschnitt prüfen (Google Maps, wird erst nach Klick geladen – Adresse: Im Looscheid 82, 45141 Essen)
- [ ] Fotos in besserer Auflösung einsetzen – die aktuellen Bilder (`assets/img/team.jpg`, `spielzimmer.jpg`, `garten.jpg`, `raum.jpg`) stammen aus dem eingescannten Flyer
- [ ] Betreuungszeiten prüfen (aktuell: Mo–Do 7:30–15:30, Fr 7:30–14:30 – nicht aus dem Flyer belegt)
