/* ==========================================================================
   Melli's Krabbelzwerge – Inhalts-Loader

   Lädt veröffentlichte Inhalte aus daten/inhalte.json und wendet zusätzlich
   lokale (unveröffentlichte) Änderungen aus dem Portal an. Elemente werden
   über data-cms-Attribute angesprochen:
     data-cms="schluessel"        → Textinhalt
     data-cms-html="schluessel"   → Text mit einfacher Formatierung
     data-cms-bild="schluessel"   → Bildquelle (src)
     data-cms-tel="schluessel"    → Telefonnummer (Text + tel:-Link)
     data-cms-mail="schluessel"   → E-Mail (Text + mailto:-Link)

   Sicherheit: die Werte aus data-cms-html landen im HTML der Seite. Sie
   werden deshalb vorher durch einen Filter geschickt, der nur harmlose
   Auszeichnungen durchlässt (fett, kursiv, Zeilenumbruch, Link …). Selbst
   wenn jemand an die Inhaltsdatei käme, ließe sich darüber kein Skript und
   kein Klickfänger auf der Seite unterbringen. Dasselbe gilt für Bild- und
   Link-Adressen: nur eigene Dateien und normale Web-Adressen sind erlaubt.
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";

  /* ------------------------------ Filter ---------------------------------- */

  // Was in den Formatier-Feldern erlaubt ist – bewusst sehr knapp gehalten.
  const ERLAUBTE_ELEMENTE = {
    BR: [],
    P: [],
    STRONG: [],
    B: [],
    EM: [],
    I: [],
    U: [],
    SMALL: [],
    SPAN: ["class"],
    A: ["href", "title", "target", "rel"],
  };

  // Adressen: eigene Dateien, http(s), E-Mail und Telefon. Kein javascript:,
  // kein data: – darüber ließen sich sonst Skripte einschleusen.
  function adresseInOrdnung(wert) {
    const roh = String(wert).trim();
    // Steuerzeichen (auch getarnte Zeilenumbrüche in "java\nscript:")
    if (/[\u0000-\u0020\u007f]/.test(roh)) return false;
    if (/^(https?:|mailto:|tel:)/i.test(roh)) return true;
    // relative Adressen wie "kontakt.html", "#unten" oder "bilder/foo.jpg"
    return !/^[a-z][a-z0-9+.-]*:/i.test(roh);
  }

  function knotenSaeubern(knoten) {
    const kinder = Array.prototype.slice.call(knoten.childNodes);

    for (const kind of kinder) {
      if (kind.nodeType === Node.TEXT_NODE) continue;

      if (kind.nodeType !== Node.ELEMENT_NODE) {
        kind.remove();                       // Kommentare und Sonstiges raus
        continue;
      }

      const erlaubteAttribute = ERLAUBTE_ELEMENTE[kind.tagName];
      if (!erlaubteAttribute) {
        // Nicht erlaubtes Element: Inhalt behalten, Hülle entfernen.
        // Bei <script>/<style> ist auch der Inhalt nichts wert.
        if (kind.tagName === "SCRIPT" || kind.tagName === "STYLE") {
          kind.remove();
          continue;
        }
        // Wichtig: erst den Inhalt säubern, dann die Hülle auflösen. Sonst
        // rutschte z. B. das <script> aus einem <div> ungeprüft nach oben,
        // weil die Kinderliste oben schon eingesammelt wurde.
        knotenSaeubern(kind);
        const inhalt = Array.prototype.slice.call(kind.childNodes);
        // Elemente ohne Inhalt verschwinden ganz – etwa ein <img onerror=…>,
        // das sonst als leere Hülle samt Angriffs-Attribut stehen bliebe.
        if (inhalt.length) kind.replaceWith.apply(kind, inhalt);
        else kind.remove();
        continue;
      }

      for (const attribut of Array.prototype.slice.call(kind.attributes)) {
        const name = attribut.name.toLowerCase();
        if (erlaubteAttribute.indexOf(name) === -1) {
          kind.removeAttribute(attribut.name);   // trifft auch alle on…-Attribute
          continue;
        }
        if ((name === "href" || name === "src") && !adresseInOrdnung(attribut.value)) {
          kind.removeAttribute(attribut.name);
        }
      }

      // Links in ein neues Fenster nie ohne diesen Schutz
      if (kind.tagName === "A" && kind.getAttribute("target") === "_blank") {
        kind.setAttribute("rel", "noopener noreferrer");
      }

      knotenSaeubern(kind);
    }
  }

  /* Setzt einen formatierten Text in ein Element ein.

     Der Text wird zuerst in einem <template> gelesen. Dessen Inhalt gehört
     zu keinem angezeigten Dokument: Skripte laufen dort nicht an und Bilder
     werden nicht geladen – ein <img src=x onerror=…> feuert also nicht schon
     beim Einlesen. Erst nach dem Aussieben wandern die übrig gebliebenen
     Knoten in die Seite. Bewusst ohne den Umweg über innerHTML zurück:
     was einmal geprüft ist, wird nicht noch einmal neu geparst. */
  function sicherSetzen(el, wert) {
    const vorlage = document.createElement("template");
    vorlage.innerHTML = String(wert);
    // Den Inhalt einmal festhalten und nur damit weiterarbeiten – nicht
    // zweimal über vorlage.content gehen. Sonst besteht die Gefahr, den
    // ungeprüften Ursprungszustand ein zweites Mal zu bekommen und damit
    // ausgerechnet das Aussortierte wieder einzusetzen.
    const inhalt = vorlage.content;
    knotenSaeubern(inhalt);
    el.replaceChildren(inhalt);
  }

  /* Bildquellen dürfen nur auf eigene Dateien zeigen. */
  function bildpfadInOrdnung(wert) {
    const roh = String(wert).trim();
    if (!roh) return false;
    if (/[\u0000-\u0020\u007f]/.test(roh)) return false;
    if (/^\/\//.test(roh)) return false;                 // fremder Server
    if (/^[a-z][a-z0-9+.-]*:/i.test(roh)) return false;  // data:, javascript: …
    return true;
  }

  /* ---------------------------- Daten anwenden ---------------------------- */

  function lokaleDaten() {
    try {
      const daten = JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL));
      return daten && typeof daten === "object" ? daten : null;
    } catch {
      return null;
    }
  }

  function anwenden(daten) {
    if (!daten || typeof daten !== "object") return;

    document.querySelectorAll("[data-cms]").forEach((el) => {
      const wert = daten[el.dataset.cms];
      if (typeof wert === "string") el.textContent = wert;
    });

    document.querySelectorAll("[data-cms-html]").forEach((el) => {
      const wert = daten[el.dataset.cmsHtml];
      if (typeof wert === "string") sicherSetzen(el, wert);
    });

    document.querySelectorAll("[data-cms-bild]").forEach((el) => {
      const wert = daten[el.dataset.cmsBild];
      if (typeof wert === "string" && bildpfadInOrdnung(wert)) el.src = wert;
    });

    document.querySelectorAll("[data-cms-tel]").forEach((el) => {
      const wert = daten[el.dataset.cmsTel];
      if (typeof wert !== "string" || !wert.trim()) return;
      el.textContent = wert;
      el.href = "tel:" + wert.replace(/[^+0-9]/g, "");
    });

    document.querySelectorAll("[data-cms-mail]").forEach((el) => {
      const wert = daten[el.dataset.cmsMail];
      if (typeof wert !== "string") return;
      const adresse = wert.trim();
      // Nur eine schlichte E-Mail-Adresse – keine zusätzlichen Kopfzeilen
      if (!/^[^\s@<>"'?&]+@[^\s@<>"'?&]+\.[^\s@<>"'?&]{2,}$/.test(adresse)) return;
      el.textContent = adresse;
      el.href = "mailto:" + adresse;
    });
  }

  /* Andere Skripte (z. B. die Neuigkeiten) können darauf reagieren,
     sobald alle Texte gesetzt sind. */
  function fertigMelden() {
    document.dispatchEvent(new CustomEvent("cms-fertig"));
  }

  function laden() {
    // Zuerst die lokale Vorschau: so nutzen die Animationen bereits den
    // neuen Text und es blitzt nichts kurz auf.
    anwenden(lokaleDaten());

    // Kein "no-store": der Server schickt "no-cache" mit ETag. Der Browser
    // fragt also jedes Mal nach, bekommt aber bei unveränderter Datei nur
    // ein knappes „unverändert" zurück statt der ganzen Datei.
    fetch("daten/inhalte.json")
      .then((antwort) => (antwort.ok ? antwort.json() : null))
      .then((veroeffentlicht) => {
        anwenden(veroeffentlicht);
        anwenden(lokaleDaten());   // lokale Änderungen haben Vorrang
      })
      .catch(() => { /* Datei fehlt – die Texte aus dem HTML bleiben stehen */ })
      .then(fertigMelden);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", laden);
  } else {
    laden();
  }
})();
