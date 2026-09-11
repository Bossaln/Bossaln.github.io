/* ==========================================================================
   Melli's Krabbelzwerge – Galerie

   Lädt die im Portal gepflegten Ordner aus daten/galerie.json:
     · Übersicht: jeder Ordner als Karte mit kleiner Vorschau-Collage
     · Öffnen: Animation, dann die Bilder in einer Mauer, deren Höhe sich
       nach dem Seitenverhältnis jedes Bildes richtet
     · Klick auf ein Bild: Großansicht mit Text, Pfeilen und Tastatur

   Alle Bewegungen laufen über motion.dev (window.Mellis.animiere). Früher
   waren es CSS-Animationen, die zum Neustarten „void element.offsetWidth"
   brauchten – dieser Trick zwingt den Browser mitten im Bildaufbau zu einer
   kompletten Layout-Berechnung und war beim Öffnen eines Ordners deutlich
   als Ruckler zu spüren.
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_galerie";  // Vorschau aus dem Portal

  let ordnerListe = [];
  let offenerOrdner = null;   // gerade geöffneter Ordner
  let lupeIndex = -1;         // welches Bild in der Großansicht steht
  let letzterFokus = null;

  /* ------------------------------- Hilfen ------------------------------- */

  /* Bewegungs-Schnittstelle aus main.js. Fehlt sie (Skriptfehler, sehr alter
     Browser), passiert einfach nichts – die Galerie funktioniert trotzdem. */
  function bewegung() {
    return window.Mellis || null;
  }

  function animiere(el, bilder, optionen) {
    const m = bewegung();
    if (!m || !m.bewegung) return Promise.resolve(false);
    return m.animiere(el, bilder, optionen);
  }

  function lokaleOrdner() {
    try {
      const daten = JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL));
      return Array.isArray(daten) ? daten : null;
    } catch {
      return null;
    }
  }

  function element(art, klasse, text) {
    const el = document.createElement(art);
    if (klasse) el.className = klasse;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function bilderZahlText(anzahl) {
    if (anzahl === 0) return "noch keine Bilder";
    return anzahl === 1 ? "1 Bild" : anzahl + " Bilder";
  }

  /* Ein Bild aus der Galerie darf nur auf eigene Dateien zeigen. */
  function pfadInOrdnung(pfad) {
    return typeof pfad === "string" &&
      /^(bilder|assets\/img)\/[A-Za-z0-9._-]{1,120}$/.test(pfad);
  }

  /* --------------------------- Ordner-Übersicht --------------------------- */

  function vorschauBauen(ordner) {
    // bis zu vier Bilder als kleine Collage – ein Blick in den Ordner
    const vorschau = element("div", "ordner-vorschau");
    const bilder = ordner.bilder.slice(0, 4);

    if (!bilder.length) {
      vorschau.classList.add("leer");
      vorschau.appendChild(element("span", null, "📁"));
      return vorschau;
    }

    vorschau.classList.add("anzahl-" + bilder.length);
    bilder.forEach((bild) => {
      const kachel = element("div", "vorschau-kachel");
      const img = document.createElement("img");
      img.src = bild.pfad;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      kachel.appendChild(img);
      vorschau.appendChild(kachel);
    });
    return vorschau;
  }

  function ordnerKarteBauen(ordner) {
    const karte = element("button", "ordner-karte einblenden");
    karte.type = "button";
    karte.setAttribute("aria-label", `Ordner „${ordner.name}“ öffnen`);

    karte.appendChild(vorschauBauen(ordner));

    const text = element("div", "ordner-text");
    text.appendChild(element("h3", null, ordner.name));
    if (ordner.beschreibung) {
      text.appendChild(element("p", null, ordner.beschreibung));
    }
    text.appendChild(element("span", "ordner-zahl", bilderZahlText(ordner.bilder.length)));
    karte.appendChild(text);

    karte.addEventListener("click", () => ordnerOeffnen(ordner.id));
    return karte;
  }

  function uebersichtZeigen(animiert) {
    const raster = document.getElementById("ordner-raster");
    const uebersicht = document.getElementById("ordner-uebersicht");
    const ansicht = document.getElementById("ordner-ansicht");
    if (!raster || !uebersicht || !ansicht) return;

    offenerOrdner = null;
    ansicht.hidden = true;
    uebersicht.hidden = false;
    raster.replaceChildren();

    if (!ordnerListe.length) {
      raster.appendChild(element("p", "galerie-hinweis",
        "Hier entstehen gerade die ersten Fotoordner – schaut bald wieder vorbei! 🌱"));
      return;
    }

    ordnerListe.forEach((ordner) => raster.appendChild(ordnerKarteBauen(ordner)));

    const m = bewegung();

    if (animiert) {
      animiere(uebersicht,
        { opacity: [0, 1], transform: ["scale(0.96) translateY(18px)", "none"] },
        { duration: 0.4, ease: m ? m.ease : undefined });
    }

    // Die Karten sind eben erst entstanden – jetzt fürs Einblenden anmelden
    if (m) m.einblendungenAnmelden(raster);
  }

  /* ---------------------------- Geöffneter Ordner ---------------------------- */

  /* Höhe aus dem Seitenverhältnis: breite Bilder werden flach, hochkant hohe
     Bilder bekommen mehr Platz. Die Mauer ordnet sich dadurch von selbst.
     Wichtig fürs Laden: dadurch steht der Platz jeder Kachel schon fest,
     bevor das Bild da ist – nichts springt beim Nachladen. */
  function bildKachelBauen(ordner, bild, index) {
    const kachel = element("figure", "mauer-bild");

    function verhaeltnisSetzen(wert) {
      const begrenzt = Math.min(Math.max(wert, 0.45), 1.9);
      kachel.style.setProperty("--verhaeltnis", begrenzt);
      kachel.classList.toggle("breit", begrenzt < 0.75);
      kachel.classList.toggle("hoch", begrenzt > 1.3);
    }

    const verhaeltnis = bild.breite > 0 && bild.hoehe > 0 ? bild.hoehe / bild.breite : null;
    if (verhaeltnis) verhaeltnisSetzen(verhaeltnis);

    const knopf = element("button", "mauer-knopf");
    knopf.type = "button";
    knopf.setAttribute("aria-label",
      bild.text ? "Bild vergrößern: " + bild.text : "Bild vergrößern");

    const img = document.createElement("img");
    img.src = bild.pfad;
    img.alt = bild.text || "Foto aus dem Ordner " + ordner.name;
    img.loading = index < 4 ? "eager" : "lazy";
    img.decoding = "async";
    if (bild.breite > 0 && bild.hoehe > 0) {
      img.width = bild.breite;
      img.height = bild.hoehe;
    }
    // Ohne gespeicherte Maße das Verhältnis nach dem Laden nachtragen
    if (!verhaeltnis) {
      img.addEventListener("load", () => {
        if (img.naturalWidth) verhaeltnisSetzen(img.naturalHeight / img.naturalWidth);
      }, { once: true });
    }
    knopf.appendChild(img);
    knopf.appendChild(element("span", "mauer-lupe", "🔍"));
    knopf.addEventListener("click", () => lupeOeffnen(index));
    kachel.appendChild(knopf);

    if (bild.text) {
      kachel.appendChild(element("figcaption", null, bild.text));
    }
    return kachel;
  }

  function ordnerOeffnen(id, ohneVerlauf) {
    const ordner = ordnerListe.find((o) => o.id === id);
    if (!ordner) return;

    const uebersicht = document.getElementById("ordner-uebersicht");
    const ansicht = document.getElementById("ordner-ansicht");
    const mauer = document.getElementById("bilder-mauer");
    if (!uebersicht || !ansicht || !mauer) return;

    offenerOrdner = ordner;

    document.getElementById("ordner-titel").textContent = ordner.name;
    const beschreibung = document.getElementById("ordner-beschreibung");
    beschreibung.textContent = ordner.beschreibung || "";
    beschreibung.hidden = !ordner.beschreibung;

    mauer.replaceChildren();
    if (!ordner.bilder.length) {
      mauer.appendChild(element("p", "galerie-hinweis", "In diesem Ordner sind noch keine Bilder."));
    } else {
      ordner.bilder.forEach((bild, i) => mauer.appendChild(bildKachelBauen(ordner, bild, i)));
    }

    uebersicht.hidden = true;
    ansicht.hidden = false;

    const m = bewegung();
    if (m && m.bewegung) {
      animiere(ansicht,
        { opacity: [0, 1], transform: ["scale(0.96) translateY(18px)", "none"] },
        { duration: 0.45, ease: m.ease });

      // Die Kacheln fächern versetzt auf – alles in einem Rutsch an den
      // Browser übergeben, ohne dazwischen das Layout auszulesen.
      mauer.querySelectorAll(".mauer-bild").forEach((kachel, i) => {
        animiere(kachel,
          { opacity: [0, 1], transform: ["translateY(26px) scale(0.96)", "none"] },
          { duration: 0.55, delay: Math.min(i * 0.06, 0.6), ease: m.ease });
      });
    }

    if (!ohneVerlauf && location.hash !== "#" + id) {
      history.pushState(null, "", "#" + id);
    }
    document.getElementById("ordner-zurueck").focus({ preventScroll: true });
    ansicht.scrollIntoView({
      behavior: m && m.bewegung ? "smooth" : "auto",
      block: "start",
    });
  }

  function ordnerSchliessen() {
    uebersichtZeigen(true);
    if (location.hash) history.pushState(null, "", location.pathname);
  }

  /* ------------------------------ Großansicht ------------------------------ */

  function lupeOeffnen(index) {
    if (!offenerOrdner || !offenerOrdner.bilder[index]) return;
    lupeIndex = index;
    letzterFokus = document.activeElement;

    const lupe = document.getElementById("lupe");
    lupe.hidden = false;
    lupe.setAttribute("aria-hidden", "false");
    document.body.classList.add("lupe-offen");
    lupeAktualisieren(false);
    document.getElementById("lupe-schliessen").focus({ preventScroll: true });
  }

  function lupeAktualisieren(mitWechsel) {
    const bild = offenerOrdner && offenerOrdner.bilder[lupeIndex];
    if (!bild) return;

    const img = document.getElementById("lupe-bild");
    const text = document.getElementById("lupe-text");
    img.src = bild.pfad;
    img.alt = bild.text || "Foto aus dem Ordner " + offenerOrdner.name;
    text.textContent = bild.text || "";
    text.hidden = !bild.text;

    const mehrere = offenerOrdner.bilder.length > 1;
    document.getElementById("lupe-zurueck").hidden = !mehrere;
    document.getElementById("lupe-vor").hidden = !mehrere;

    if (!mitWechsel) return;
    const m = bewegung();
    animiere(document.querySelector(".lupe-inhalt"),
      { opacity: [0, 1], transform: ["translateY(26px) scale(0.96)", "none"] },
      { duration: 0.35, ease: m ? m.ease : undefined });
  }

  function lupeBlaettern(richtung) {
    if (!offenerOrdner || !offenerOrdner.bilder.length) return;
    const anzahl = offenerOrdner.bilder.length;
    lupeIndex = (lupeIndex + richtung + anzahl) % anzahl;
    lupeAktualisieren(true);
  }

  function lupeSchliessen() {
    const lupe = document.getElementById("lupe");
    lupe.hidden = true;
    lupe.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lupe-offen");
    document.getElementById("lupe-bild").removeAttribute("src");
    if (letzterFokus && letzterFokus.focus) letzterFokus.focus({ preventScroll: true });
    letzterFokus = null;
  }

  function lupeIstOffen() {
    const lupe = document.getElementById("lupe");
    return Boolean(lupe) && !lupe.hidden;
  }

  /* Solange die Großansicht offen ist, bleibt der Tastatur-Fokus darin.
     Sonst wandert man mit der Tabulatortaste unsichtbar durch die Seite
     dahinter – für Menschen, die ohne Maus bedienen, sehr verwirrend. */
  function fokusFesthalten(e) {
    const lupe = document.getElementById("lupe");
    const bedienbar = Array.prototype.filter.call(
      lupe.querySelectorAll("button"), (el) => !el.hidden);
    if (!bedienbar.length) return;

    const erster = bedienbar[0];
    const letzter = bedienbar[bedienbar.length - 1];

    if (e.shiftKey && document.activeElement === erster) {
      e.preventDefault();
      letzter.focus();
    } else if (!e.shiftKey && document.activeElement === letzter) {
      e.preventDefault();
      erster.focus();
    }
  }

  /* --------------------------------- Start --------------------------------- */

  function bedienungVerbinden() {
    const zurueck = document.getElementById("ordner-zurueck");
    const lupe = document.getElementById("lupe");
    if (!zurueck || !lupe) return false;

    zurueck.addEventListener("click", ordnerSchliessen);
    document.getElementById("lupe-schliessen").addEventListener("click", lupeSchliessen);
    document.getElementById("lupe-zurueck").addEventListener("click", () => lupeBlaettern(-1));
    document.getElementById("lupe-vor").addEventListener("click", () => lupeBlaettern(1));

    // Klick auf den Hintergrund schließt die Großansicht
    lupe.addEventListener("click", (e) => {
      if (e.target === lupe) lupeSchliessen();
    });

    document.addEventListener("keydown", (e) => {
      if (lupeIstOffen()) {
        if (e.key === "Escape") lupeSchliessen();
        else if (e.key === "ArrowLeft") lupeBlaettern(-1);
        else if (e.key === "ArrowRight") lupeBlaettern(1);
        else if (e.key === "Tab") fokusFesthalten(e);
        return;
      }
      if (e.key === "Escape" && offenerOrdner) ordnerSchliessen();
    });

    // Zurück-Knopf des Browsers
    window.addEventListener("popstate", () => {
      const id = location.hash.replace("#", "");
      if (id && ordnerListe.some((o) => o.id === id)) ordnerOeffnen(id, true);
      else uebersichtZeigen(false);
    });

    return true;
  }

  function anzeigen(ordner) {
    ordnerListe = (Array.isArray(ordner) ? ordner : [])
      .filter((o) => o && typeof o === "object" && o.name)
      .map((o) => ({
        id: typeof o.id === "string" ? o.id : "",
        name: String(o.name),
        beschreibung: typeof o.beschreibung === "string" ? o.beschreibung : "",
        bilder: (Array.isArray(o.bilder) ? o.bilder : []).filter((b) => b && pfadInOrdnung(b.pfad)),
      }));

    uebersichtZeigen(false);

    const id = location.hash.replace("#", "");
    if (id && ordnerListe.some((o) => o.id === id)) ordnerOeffnen(id, true);
  }

  function laden() {
    if (!bedienungVerbinden()) return;

    const vorschau = lokaleOrdner();

    fetch("daten/galerie.json")
      .then((antwort) => (antwort.ok ? antwort.json() : []))
      .then((ordner) => anzeigen(vorschau || ordner))
      .catch(() => anzeigen(vorschau || []));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", laden);
  } else {
    laden();
  }
})();
