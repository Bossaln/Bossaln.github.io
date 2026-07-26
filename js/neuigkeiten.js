/* ==========================================================================
   Melli's Krabbelzwerge – Neuigkeiten
   Lädt die im Portal geschriebenen Beiträge aus daten/beitraege.json und
   zeigt sie als Beitragsstrom an – neueste zuerst.
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_beitraege";  // Vorschau aus dem Portal

  function lokaleBeitraege() {
    try {
      const daten = JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL));
      return Array.isArray(daten) ? daten : null;
    } catch {
      return null;
    }
  }

  /* „vor 3 Tagen“ statt eines nackten Datums */
  function relativeZeit(zeitpunkt) {
    const sekunden = Math.round((Date.now() - zeitpunkt.getTime()) / 1000);
    if (sekunden < 0) return "gerade eben";
    if (sekunden < 60) return "gerade eben";

    const minuten = Math.round(sekunden / 60);
    if (minuten < 60) return minuten === 1 ? "vor einer Minute" : `vor ${minuten} Minuten`;

    const stunden = Math.round(minuten / 60);
    if (stunden < 24) return stunden === 1 ? "vor einer Stunde" : `vor ${stunden} Stunden`;

    const tage = Math.round(stunden / 24);
    if (tage === 1) return "gestern";
    if (tage < 7) return `vor ${tage} Tagen`;
    if (tage < 31) {
      const wochen = Math.round(tage / 7);
      return wochen === 1 ? "vor einer Woche" : `vor ${wochen} Wochen`;
    }
    if (tage < 365) {
      const monate = Math.round(tage / 30);
      return monate === 1 ? "vor einem Monat" : `vor ${monate} Monaten`;
    }
    const jahre = Math.round(tage / 365);
    return jahre === 1 ? "vor einem Jahr" : `vor ${jahre} Jahren`;
  }

  function langesDatum(zeitpunkt) {
    return zeitpunkt.toLocaleDateString("de-DE", {
      day: "numeric", month: "long", year: "numeric",
    }) + ", " + zeitpunkt.toLocaleTimeString("de-DE", {
      hour: "2-digit", minute: "2-digit",
    }) + " Uhr";
  }

  /* Logo aus der Seite übernehmen – so zeigt der Beitragskopf immer das
     aktuelle Logo, auch wenn es im Portal getauscht wurde. */
  function logoQuelle() {
    const logo = document.querySelector('[data-cms-bild="bild_logo"]');
    return logo ? logo.getAttribute("src") : "assets/img/logo.png";
  }

  /* Baut eine Beitragskarte. Texte werden bewusst als Text eingesetzt
     (kein innerHTML), damit im Portal getippte Zeichen wie < harmlos sind. */
  function beitragBauen(beitrag, nummer) {
    const zeitpunkt = new Date(beitrag.zeit);
    const gueltig = !isNaN(zeitpunkt.getTime());

    const artikel = document.createElement("article");
    artikel.className = "beitrag einblenden";

    const kopf = document.createElement("header");
    kopf.className = "beitrag-kopf";

    const avatar = document.createElement("img");
    avatar.className = "beitrag-avatar";
    avatar.src = logoQuelle();
    avatar.alt = "";
    kopf.appendChild(avatar);

    if (gueltig) {
      const zeit = document.createElement("time");
      zeit.dateTime = zeitpunkt.toISOString();
      zeit.textContent = relativeZeit(zeitpunkt);
      zeit.title = langesDatum(zeitpunkt);
      kopf.appendChild(zeit);
    }
    artikel.appendChild(kopf);

    if (beitrag.bild) {
      const bildRahmen = document.createElement("div");
      bildRahmen.className = "beitrag-bild";
      const bild = document.createElement("img");
      bild.src = beitrag.bild;
      bild.alt = beitrag.titel ? "Bild zum Beitrag: " + beitrag.titel : "Bild zum Beitrag";
      bild.loading = nummer > 1 ? "lazy" : "eager";
      bildRahmen.appendChild(bild);
      artikel.appendChild(bildRahmen);
    }

    const koerper = document.createElement("div");
    koerper.className = "beitrag-text";

    if (beitrag.titel) {
      const titel = document.createElement("h3");
      titel.textContent = beitrag.titel;
      koerper.appendChild(titel);
    }

    String(beitrag.text || "")
      .split(/\n{2,}/)
      .map((absatz) => absatz.trim())
      .filter(Boolean)
      .forEach((absatz) => {
        const p = document.createElement("p");
        // einfache Zeilenumbrüche innerhalb eines Absatzes erhalten
        absatz.split("\n").forEach((zeile, i) => {
          if (i > 0) p.appendChild(document.createElement("br"));
          p.appendChild(document.createTextNode(zeile));
        });
        koerper.appendChild(p);
      });

    artikel.appendChild(koerper);

    if (gueltig) {
      const fuss = document.createElement("footer");
      fuss.className = "beitrag-fuss";
      fuss.textContent = "🗓️ " + langesDatum(zeitpunkt);
      artikel.appendChild(fuss);
    }

    return artikel;
  }

  function leerHinweis(text) {
    const hinweis = document.createElement("p");
    hinweis.className = "beitrag-hinweis";
    hinweis.textContent = text;
    return hinweis;
  }

  function anzeigen(beitraege) {
    const halter = document.getElementById("beitraege");
    if (!halter) return;

    halter.innerHTML = "";

    const liste = (Array.isArray(beitraege) ? beitraege : [])
      .filter((b) => b && (b.titel || b.text || b.bild))
      .sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit));

    if (!liste.length) {
      halter.appendChild(leerHinweis(
        "Hier ist noch nichts los – die ersten Neuigkeiten kommen bald! 🌱"));
      return;
    }

    liste.forEach((beitrag, i) => halter.appendChild(beitragBauen(beitrag, i + 1)));

    // Einblend-Animation auch für die frisch erzeugten Karten starten
    if (typeof window.initEinblendungen === "function") window.initEinblendungen();

    // Sicherheitsnetz: Beiträge dürfen nie unsichtbar hängen bleiben,
    // falls die Animation nicht anspringt.
    setTimeout(() => {
      halter.querySelectorAll(".beitrag.einblenden").forEach((karte) => {
        const oben = karte.getBoundingClientRect().top;
        if (oben < window.innerHeight) karte.classList.add("sichtbar");
      });
    }, 2000);
  }

  function laden() {
    const vorschau = lokaleBeitraege();

    fetch("daten/beitraege.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((beitraege) => anzeigen(vorschau || beitraege))
      .catch(() => anzeigen(vorschau || []));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", laden);
  } else {
    laden();
  }
})();
