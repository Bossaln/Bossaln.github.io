/* ==========================================================================
   Melli's Krabbelzwerge – Inhalts-Loader
   Lädt veröffentlichte Inhalte aus daten/inhalte.json und wendet zusätzlich
   lokale (unveröffentlichte) Änderungen aus dem Portal an. Elemente werden
   über data-cms-Attribute angesprochen:
     data-cms="schluessel"        → Textinhalt
     data-cms-html="schluessel"   → Inhalt mit einfacher Formatierung
                                    (wird vor dem Einfügen bereinigt)
     data-cms-bild="schluessel"   → Bildquelle (src)
     data-cms-tel="schluessel"    → Telefonnummer (Text + tel:-Link)
     data-cms-mail="schluessel"   → E-Mail (Text + mailto:-Link)

   window.cmsBereit ist ein Promise, das erfüllt wird, sobald die
   veröffentlichten Inhalte angewendet wurden (Animationen warten darauf).
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";

  /* Bereinigt HTML aus Inhaltsfeldern: nur harmlose Formatierungs-Elemente
     und -Attribute bleiben erhalten. Skripte, Event-Handler (onclick …) und
     gefährliche Link-Ziele (javascript: …) werden entfernt. Schützt davor,
     dass über eine manipulierte inhalte.json oder den lokalen Speicher
     Schadcode in die Seiten gelangt. */
  const ERLAUBTE_ELEMENTE = ["A", "B", "BR", "CODE", "EM", "I", "SMALL", "SPAN", "STRONG", "U", "WBR"];
  const ERLAUBTE_ATTRIBUTE = { "*": ["class", "style"], A: ["href", "target", "rel"] };
  const ERLAUBTE_LINKZIELE = /^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i;

  function bereinigen(html) {
    const doc = new DOMParser().parseFromString(String(html), "text/html");

    (function laufe(knoten) {
      [...knoten.childNodes].forEach((kind) => {
        if (kind.nodeType === Node.TEXT_NODE) return;
        if (kind.nodeType !== Node.ELEMENT_NODE || !ERLAUBTE_ELEMENTE.includes(kind.tagName)) {
          kind.remove();
          return;
        }
        [...kind.attributes].forEach((attr) => {
          const erlaubt = ERLAUBTE_ATTRIBUTE["*"].includes(attr.name) ||
            (ERLAUBTE_ATTRIBUTE[kind.tagName] || []).includes(attr.name);
          if (!erlaubt) kind.removeAttribute(attr.name);
        });
        if (kind.tagName === "A") {
          const ziel = (kind.getAttribute("href") || "").trim();
          if (ziel && !ERLAUBTE_LINKZIELE.test(ziel)) kind.removeAttribute("href");
          if (kind.getAttribute("target") === "_blank") kind.setAttribute("rel", "noopener");
        }
        laufe(kind);
      });
    })(doc.body);

    return doc.body.innerHTML;
  }

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
      if (typeof wert === "string") el.innerHTML = bereinigen(wert);
    });

    document.querySelectorAll("[data-cms-bild]").forEach((el) => {
      const wert = daten[el.dataset.cmsBild];
      // nur relative Pfade und eingebettete Bilder (data:image/…) zulassen
      if (typeof wert === "string" && wert &&
          (/^data:image\//i.test(wert) || !/^[a-z]+:/i.test(wert))) {
        el.src = wert;
      }
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
        el.href = "mailto:" + encodeURIComponent(wert).replace(/%40/g, "@");
      }
    });
  }

  let bereitMelden;
  window.cmsBereit = new Promise((erfuellen) => { bereitMelden = erfuellen; });

  function alles() {
    // veröffentlichte Inhalte laden, lokale Änderungen haben Vorrang
    fetch("daten/inhalte.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((veroeffentlicht) => {
        anwenden(veroeffentlicht);
        anwenden(lokaleDaten());
      })
      .catch(() => anwenden(lokaleDaten()))
      .finally(() => bereitMelden());
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
