/* ==========================================================================
   Melli's Krabbelzwerge – Inhalts-Loader
   Lädt veröffentlichte Inhalte aus daten/inhalte.json und wendet zusätzlich
   lokale (unveröffentlichte) Änderungen aus dem Portal an. Elemente werden
   über data-cms-Attribute angesprochen:
     data-cms="schluessel"        → Textinhalt
     data-cms-bild="schluessel"   → Bildquelle (src)
     data-cms-tel="schluessel"    → Telefonnummer (Text + tel:-Link)
     data-cms-mail="schluessel"   → E-Mail (Text + mailto:-Link)
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";

  function lokaleDaten() {
    try {
      return JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL)) || null;
    } catch {
      return null;
    }
  }

  function anwenden(daten) {
    if (!daten) return;

    document.querySelectorAll("[data-cms]").forEach((el) => {
      const wert = daten[el.dataset.cms];
      if (typeof wert === "string") el.textContent = wert;
    });

    // Felder mit einfacher Formatierung (fett, Zeilenumbrüche, farbige Wörter)
    document.querySelectorAll("[data-cms-html]").forEach((el) => {
      const wert = daten[el.dataset.cmsHtml];
      if (typeof wert === "string") el.innerHTML = wert;
    });

    document.querySelectorAll("[data-cms-bild]").forEach((el) => {
      const wert = daten[el.dataset.cmsBild];
      if (typeof wert === "string" && wert) el.src = wert;
    });

    document.querySelectorAll("[data-cms-tel]").forEach((el) => {
      const wert = daten[el.dataset.cmsTel];
      if (typeof wert === "string" && wert) {
        el.textContent = wert;
        el.href = "tel:" + wert.replace(/[^+0-9]/g, "");
      }
    });

    document.querySelectorAll("[data-cms-mail]").forEach((el) => {
      const wert = daten[el.dataset.cmsMail];
      if (typeof wert === "string" && wert) {
        el.textContent = wert;
        el.href = "mailto:" + wert;
      }
    });
  }

  function alles() {
    // veröffentlichte Inhalte laden, lokale Änderungen haben Vorrang
    fetch("daten/inhalte.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((veroeffentlicht) => {
        anwenden(veroeffentlicht);
        anwenden(lokaleDaten());
      })
      .catch(() => anwenden(lokaleDaten()));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      anwenden(lokaleDaten()); // sofort, damit Animationen den neuen Text nutzen
      alles();
    });
  } else {
    anwenden(lokaleDaten());
    alles();
  }
})();
