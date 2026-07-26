/* ==========================================================================
   Melli's Krabbelzwerge – Galerie
   Lädt die im Portal gepflegten Ordner aus daten/galerie.json:
     · Übersicht: jeder Ordner als Karte mit kleiner Vorschau-Collage
     · Öffnen: Animation, dann die Bilder in einer Mauer, deren Höhe sich
       nach dem Seitenverhältnis jedes Bildes richtet
     · Klick auf ein Bild: Großansicht mit Text, Pfeilen und Tastatur
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_galerie";  // Vorschau aus dem Portal

  let ordnerListe = [];
  let offenerOrdner = null;   // gerade geöffneter Ordner
  let lupeIndex = -1;         // welches Bild in der Großansicht steht
  let letzterFokus = null;

  /* ------------------------------- Hilfen ------------------------------- */

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
    if (!raster) return;

    offenerOrdner = null;
    ansicht.hidden = true;
    uebersicht.hidden = false;
    raster.innerHTML = "";

    if (!ordnerListe.length) {
      const hinweis = element("p", "galerie-hinweis",
        "Hier entstehen gerade die ersten Fotoordner – schaut bald wieder vorbei! 🌱");
      raster.appendChild(hinweis);
      return;
    }

    ordnerListe.forEach((ordner) => raster.appendChild(ordnerKarteBauen(ordner)));
    if (animiert) {
      uebersicht.classList.remove("schliesst-auf");
      void uebersicht.offsetWidth;   // Animation neu starten
      uebersicht.classList.add("schliesst-auf");
    }
    sichtbarMachen(raster);
  }

  /* ---------------------------- Geöffneter Ordner ---------------------------- */

  /* Höhe aus dem Seitenverhältnis: breite Bilder werden flach, hochkant hohe
     Bilder bekommen mehr Platz. Die Mauer ordnet sich dadurch von selbst. */
  function bildKachelBauen(ordner, bild, index) {
    const kachel = element("figure", "mauer-bild");

    const verhaeltnis = bild.breite > 0 && bild.hoehe > 0 ? bild.hoehe / bild.breite : null;
    if (verhaeltnis) {
      // sehr extreme Formate etwas bändigen, damit nichts aus dem Rahmen fällt
      const begrenzt = Math.min(Math.max(verhaeltnis, 0.45), 1.9);
      kachel.style.setProperty("--verhaeltnis", begrenzt);
      if (begrenzt < 0.75) kachel.classList.add("breit");
      if (begrenzt > 1.3) kachel.classList.add("hoch");
    }

    const knopf = element("button", "mauer-knopf");
    knopf.type = "button";
    knopf.setAttribute("aria-label",
      bild.text ? "Bild vergrößern: " + bild.text : "Bild vergrößern");

    const img = document.createElement("img");
    img.src = bild.pfad;
    img.alt = bild.text || "Foto aus dem Ordner " + ordner.name;
    img.loading = index < 4 ? "eager" : "lazy";
    // Ohne gespeicherte Maße das Verhältnis nach dem Laden nachtragen
    if (!verhaeltnis) {
      img.addEventListener("load", () => {
        if (!img.naturalWidth) return;
        const gemessen = Math.min(Math.max(img.naturalHeight / img.naturalWidth, 0.45), 1.9);
        kachel.style.setProperty("--verhaeltnis", gemessen);
        if (gemessen < 0.75) kachel.classList.add("breit");
        if (gemessen > 1.3) kachel.classList.add("hoch");
      });
    }
    knopf.appendChild(img);

    const lupenzeichen = element("span", "mauer-lupe", "🔍");
    knopf.appendChild(lupenzeichen);
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

    offenerOrdner = ordner;
    const uebersicht = document.getElementById("ordner-uebersicht");
    const ansicht = document.getElementById("ordner-ansicht");
    const mauer = document.getElementById("bilder-mauer");

    document.getElementById("ordner-titel").textContent = ordner.name;
    const beschreibung = document.getElementById("ordner-beschreibung");
    beschreibung.textContent = ordner.beschreibung || "";
    beschreibung.hidden = !ordner.beschreibung;

    mauer.innerHTML = "";
    if (!ordner.bilder.length) {
      mauer.appendChild(element("p", "galerie-hinweis", "In diesem Ordner sind noch keine Bilder."));
    } else {
      ordner.bilder.forEach((bild, i) => mauer.appendChild(bildKachelBauen(ordner, bild, i)));
    }

    uebersicht.hidden = true;
    ansicht.hidden = false;

    // Öffnungs-Animation: Ansicht wächst auf, Bilder folgen versetzt
    ansicht.classList.remove("oeffnet");
    void ansicht.offsetWidth;
    ansicht.classList.add("oeffnet");
    mauer.querySelectorAll(".mauer-bild").forEach((kachel, i) => {
      kachel.style.animationDelay = Math.min(i * 60, 600) + "ms";
    });

    if (!ohneVerlauf && location.hash !== "#" + id) {
      history.pushState(null, "", "#" + id);
    }
    document.getElementById("ordner-zurueck").focus({ preventScroll: true });
    ansicht.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function ordnerSchliessen() {
    uebersichtZeigen(true);
    if (location.hash) history.pushState(null, "", location.pathname);
  }

  /* Karten, die per JavaScript entstehen, ins Blickfeld holen */
  function sichtbarMachen(halter) {
    if (typeof window.initEinblendungen === "function") window.initEinblendungen();
    setTimeout(() => {
      halter.querySelectorAll(".einblenden").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("sichtbar");
      });
    }, 2000);
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
    lupeAktualisieren();
    document.getElementById("lupe-schliessen").focus({ preventScroll: true });
  }

  function lupeAktualisieren() {
    const bild = offenerOrdner.bilder[lupeIndex];
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

    const inhalt = document.querySelector(".lupe-inhalt");
    inhalt.classList.remove("wechselt");
    void inhalt.offsetWidth;
    inhalt.classList.add("wechselt");
  }

  function lupeBlaettern(richtung) {
    if (!offenerOrdner) return;
    const anzahl = offenerOrdner.bilder.length;
    lupeIndex = (lupeIndex + richtung + anzahl) % anzahl;
    lupeAktualisieren();
  }

  function lupeSchliessen() {
    const lupe = document.getElementById("lupe");
    lupe.hidden = true;
    lupe.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lupe-offen");
    document.getElementById("lupe-bild").removeAttribute("src");
    if (letzterFokus && letzterFokus.focus) letzterFokus.focus({ preventScroll: true });
  }

  function lupeIstOffen() {
    const lupe = document.getElementById("lupe");
    return lupe && !lupe.hidden;
  }

  /* --------------------------------- Start --------------------------------- */

  function bedienungVerbinden() {
    document.getElementById("ordner-zurueck").addEventListener("click", ordnerSchliessen);
    document.getElementById("lupe-schliessen").addEventListener("click", lupeSchliessen);
    document.getElementById("lupe-zurueck").addEventListener("click", () => lupeBlaettern(-1));
    document.getElementById("lupe-vor").addEventListener("click", () => lupeBlaettern(1));

    // Klick auf den Hintergrund schließt die Großansicht
    document.getElementById("lupe").addEventListener("click", (e) => {
      if (e.target.id === "lupe") lupeSchliessen();
    });

    document.addEventListener("keydown", (e) => {
      if (lupeIstOffen()) {
        if (e.key === "Escape") lupeSchliessen();
        if (e.key === "ArrowLeft") lupeBlaettern(-1);
        if (e.key === "ArrowRight") lupeBlaettern(1);
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
  }

  function anzeigen(ordner) {
    ordnerListe = (Array.isArray(ordner) ? ordner : [])
      .filter((o) => o && o.name)
      .map((o) => Object.assign({}, o, { bilder: Array.isArray(o.bilder) ? o.bilder : [] }));

    const id = location.hash.replace("#", "");
    if (id && ordnerListe.some((o) => o.id === id)) {
      uebersichtZeigen(false);
      ordnerOeffnen(id, true);
    } else {
      uebersichtZeigen(false);
    }
  }

  function laden() {
    bedienungVerbinden();
    const vorschau = lokaleOrdner();

    fetch("daten/galerie.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((ordner) => anzeigen(vorschau || ordner))
      .catch(() => anzeigen(vorschau || []));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", laden);
  } else {
    laden();
  }
})();
