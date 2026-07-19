# Melli's Krabbelzwerge – Website

Website der Großtagespflege **Melli's Krabbelzwerge** in Essen-Stoppenberg.

> „Alles was ein Kind braucht, um glücklich zu sein."

> **Hinweis:** Alle Inhaltstexte sind aktuell bewusst Lorem-ipsum-Platzhalter,
> damit der Fokus auf dem Design liegt. Die echten Texte werden später
> eingesetzt. Navigation, Footer und Logo sind bereits final beschriftet.

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

## Lokal ansehen

Einfach `index.html` im Browser öffnen – oder einen kleinen Server starten:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Vor dem Livegang anpassen

- [ ] Echte Telefonnummer und E-Mail-Adresse eintragen (Platzhalter: `0201 / 00 00 00 00`, `info@mellis-krabbelzwerge.de`)
- [ ] Namen im Impressum und in der Datenschutzerklärung ergänzen
- [ ] Kartenausschnitt in `kontakt.html` auf die exakten Koordinaten setzen
- [ ] Echte Fotos in der Galerie ergänzen (Einverständnis beachten!)
- [ ] Betreuungszeiten und Fakten (Plätze, Team) prüfen
