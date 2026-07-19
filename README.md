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
| `konzept.html` | Pädagogisches Konzept, Schwerpunkte, Eingewöhnung, Ernährung |
| `tagesablauf.html` | Tagesablauf als Zeitstrahl + FAQ |
| `galerie.html` | Galerie (Platzhalter-Kacheln, bis echte Fotos vorliegen) |
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

## Verwaltungs-Portal (`admin.html`)

Unter `/admin.html` (Footer-Link „Portal") können Betreuungszeiten,
Kontaktdaten, der Slogan und die Fotos ohne Programmierkenntnisse
geändert werden.

**Ablauf:** Änderungen im Portal → „Vorschau speichern" (sofort im eigenen
Browser sichtbar) → „Veröffentlichen" lädt eine `inhalte.json` herunter →
diese Datei in den Ordner `daten/` der Website hochladen (ersetzen). Erst
dann sehen alle Besucher die Änderungen.

**Sicherheit:**

- Das Passwort wird niemals gespeichert – in `daten/zugang.json` liegt nur
  ein PBKDF2-SHA256-Hash (310.000 Iterationen, zufälliges Salt).
- Nach 5 Fehlversuchen wird die Anmeldung exponentiell lange gesperrt;
  die Sitzung läuft nach 30 Minuten Inaktivität ab.
- Die Portal-Seite hat eine strikte Content-Security-Policy und ist für
  Suchmaschinen gesperrt (`noindex`).
- Wichtig zu wissen: Da die Website statisch gehostet wird, schützt das
  Passwort den Bearbeitungszugang. Die öffentliche Website kann ohne
  Zugriff auf den Webspace/das Repository grundsätzlich nicht verändert
  werden – auch nicht über das Portal.

**Passwort ändern:** im Portal unter „Passwort ändern" eine neue
`zugang.json` erzeugen und in `daten/` hochladen. Passwort vergessen?
Neue Datei per Kommandozeile erzeugen:

```bash
node -e "const c=require('crypto');const pw=process.argv[1];const salz=c.randomBytes(16).toString('hex');const it=310000;const hash=c.pbkdf2Sync(pw,Buffer.from(salz,'hex'),it,32,'sha256').toString('hex');console.log(JSON.stringify({algorithmus:'PBKDF2-SHA256',iterationen:it,salz,hash},null,2))" 'NEUES-PASSWORT'
```

## Lokal ansehen

Einfach `index.html` im Browser öffnen – oder einen kleinen Server starten:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Vor dem Livegang anpassen

- [ ] Echte Telefonnummer und E-Mail-Adresse eintragen (Platzhalter: `0201 / 00 00 00 00`, `info@mellis-krabbelzwerge.de`)
- [ ] Kartenausschnitt in `kontakt.html` auf die exakten Koordinaten setzen (aktuell grob auf Stoppenberg zentriert)
- [ ] Fotos in besserer Auflösung einsetzen – die aktuellen Bilder (`assets/img/team.jpg`, `spielzimmer.jpg`, `garten.jpg`, `raum.jpg`) stammen aus dem eingescannten Flyer
- [ ] Betreuungszeiten prüfen (aktuell: Mo–Do 7:30–15:30, Fr 7:30–14:30 – nicht aus dem Flyer belegt)
