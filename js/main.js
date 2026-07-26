/* ==========================================================================
   Melli's Krabbelzwerge – JavaScript
   Mobile Navigation, Scroll-Effekte, Akkordeon, Zähler, Kontaktformular
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initNachObenKnopf();
  initEinblendungen();
  initSchreibmaschine();
  initAkkordeon();
  initZaehler();
  initKontaktformular();
  initKartenConsent();
});

/* --------------------------------------------------------------------------
   Mobile Navigation (Hamburger-Menü)
   -------------------------------------------------------------------------- */
function initNavigation() {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const offen = links.classList.toggle("offen");
    toggle.setAttribute("aria-expanded", offen ? "true" : "false");
  });

  // Menü schließen, wenn ein Link angeklickt wird
  links.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      links.classList.remove("offen");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  // Menü schließen bei Klick außerhalb
  document.addEventListener("click", (e) => {
    if (!links.contains(e.target) && !toggle.contains(e.target)) {
      links.classList.remove("offen");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* --------------------------------------------------------------------------
   "Nach oben"-Knopf
   -------------------------------------------------------------------------- */
function initNachObenKnopf() {
  const knopf = document.querySelector(".nach-oben");
  if (!knopf) return;

  // höchstens einmal pro Frame auswerten, damit das Scrollen flüssig bleibt
  let angefragt = false;
  let sichtbar = false;

  function aktualisieren() {
    angefragt = false;
    const soll = window.scrollY > 450;
    if (soll !== sichtbar) {
      sichtbar = soll;
      knopf.classList.toggle("sichtbar", soll);
    }
  }

  window.addEventListener("scroll", () => {
    if (!angefragt) {
      angefragt = true;
      requestAnimationFrame(aktualisieren);
    }
  }, { passive: true });

  knopf.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* --------------------------------------------------------------------------
   Elemente beim Scrollen einblenden
   -------------------------------------------------------------------------- */
function initEinblendungen() {
  const elemente = document.querySelectorAll(".einblenden");
  if (!elemente.length) return;

  if (!("IntersectionObserver" in window)) {
    elemente.forEach((el) => el.classList.add("sichtbar"));
    return;
  }

  const beobachter = new IntersectionObserver((eintraege) => {
    eintraege.forEach((eintrag) => {
      if (eintrag.isIntersecting) {
        const el = eintrag.target;
        el.classList.add("sichtbar");
        beobachter.unobserve(el);
        // Nach der Animation Klassen entfernen, damit Hover-Effekte
        // (transform) nicht von .einblenden.sichtbar überschrieben werden
        setTimeout(() => {
          el.classList.remove("einblenden", "sichtbar");
          el.style.transitionDelay = "";
        }, 1100);
      }
    });
  }, { threshold: 0.12 });

  elemente.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i % 4, 3) * 90}ms`;
    beobachter.observe(el);
  });
}

/* --------------------------------------------------------------------------
   Schreibmaschinen-Effekt: Text in [data-tippen] wird Zeichen für Zeichen
   getippt, sobald das Element sichtbar wird.
   -------------------------------------------------------------------------- */
function initSchreibmaschine() {
  const elemente = document.querySelectorAll("[data-tippen]");
  if (!elemente.length) return;

  const bewegungReduziert =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Ohne Beobachter oder bei reduzierter Bewegung: Text einfach stehen lassen
  if (bewegungReduziert || !("IntersectionObserver" in window)) return;

  // zeitbasiert über requestAnimationFrame statt setInterval:
  // ruckelt nicht, wenn der Browser gerade anderweitig beschäftigt ist
  function tippe(el) {
    const text = el.textContent;
    const msProZeichen = 38;
    el.textContent = "";
    el.classList.add("tippt");
    let start = null;
    let bisher = 0;

    function schritt(jetzt) {
      if (start === null) start = jetzt;
      const anzahl = Math.min(text.length, Math.floor((jetzt - start) / msProZeichen) + 1);
      if (anzahl !== bisher) {
        bisher = anzahl;
        el.textContent = text.slice(0, anzahl);
      }
      if (anzahl < text.length) {
        requestAnimationFrame(schritt);
      } else {
        // Cursor nach kurzem Nachblinken ausblenden
        setTimeout(() => el.classList.remove("tippt"), 1600);
      }
    }

    requestAnimationFrame(schritt);
  }

  function beobachten() {
    const beobachter = new IntersectionObserver((eintraege) => {
      eintraege.forEach((eintrag) => {
        if (eintrag.isIntersecting) {
          tippe(eintrag.target);
          beobachter.unobserve(eintrag.target);
        }
      });
    }, { threshold: 0.6 });

    elemente.forEach((el) => beobachter.observe(el));
  }

  // erst starten, wenn der Inhalts-Loader (cms.js) die veröffentlichten
  // Texte angewendet hat – sonst tippt der Effekt einen veralteten Text
  if (window.cmsBereit && typeof window.cmsBereit.then === "function") {
    let gestartet = false;
    const einmal = () => { if (!gestartet) { gestartet = true; beobachten(); } };
    window.cmsBereit.then(einmal, einmal);
    setTimeout(einmal, 1500); // Sicherheitsnetz, falls das Laden hängt
  } else {
    beobachten();
  }
}

/* --------------------------------------------------------------------------
   Akkordeon (FAQ, Eingewöhnung)
   -------------------------------------------------------------------------- */
function initAkkordeon() {
  function schliessen(punkt) {
    const antwort = punkt.querySelector(".akkordeon-antwort");
    // von "auto"-Höhe aus kann nicht animiert werden – erst die aktuelle
    // Pixelhöhe setzen, Reflow erzwingen, dann auf 0 zusammenklappen
    antwort.style.maxHeight = antwort.scrollHeight + "px";
    void antwort.offsetHeight;
    antwort.style.maxHeight = "0px";
    punkt.classList.remove("offen");
    punkt.querySelector(".akkordeon-frage").setAttribute("aria-expanded", "false");
  }

  document.querySelectorAll(".akkordeon-punkt").forEach((punkt) => {
    const frage = punkt.querySelector(".akkordeon-frage");
    const antwort = punkt.querySelector(".akkordeon-antwort");
    if (!frage || !antwort) return;

    // nach dem Aufklappen Höhe freigeben, damit sich der Inhalt z. B. bei
    // Fenstergrößen-Änderungen nicht abgeschnitten wird
    antwort.addEventListener("transitionend", () => {
      if (punkt.classList.contains("offen")) antwort.style.maxHeight = "none";
    });

    frage.addEventListener("click", () => {
      const istOffen = punkt.classList.contains("offen");

      // andere Punkte im selben Akkordeon schließen
      punkt.closest(".akkordeon")
        .querySelectorAll(".akkordeon-punkt.offen")
        .forEach(schliessen);

      if (!istOffen) {
        punkt.classList.add("offen");
        antwort.style.maxHeight = antwort.scrollHeight + "px";
        frage.setAttribute("aria-expanded", "true");
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Zahlen hochzählen (Fakten-Bereich)
   -------------------------------------------------------------------------- */
function initZaehler() {
  const zaehler = document.querySelectorAll("[data-ziel]");
  const bewegungReduziert =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!zaehler.length || bewegungReduziert || !("IntersectionObserver" in window)) {
    zaehler.forEach((z) => { z.textContent = z.dataset.ziel; });
    return;
  }

  const beobachter = new IntersectionObserver((eintraege) => {
    eintraege.forEach((eintrag) => {
      if (!eintrag.isIntersecting) return;
      const el = eintrag.target;
      const ziel = parseInt(el.dataset.ziel, 10);
      const dauer = 1400;
      const start = performance.now();

      function schritt(jetzt) {
        const fortschritt = Math.min((jetzt - start) / dauer, 1);
        // sanftes Abbremsen am Ende
        const wert = Math.round(ziel * (1 - Math.pow(1 - fortschritt, 3)));
        el.textContent = wert;
        if (fortschritt < 1) requestAnimationFrame(schritt);
      }

      requestAnimationFrame(schritt);
      beobachter.unobserve(el);
    });
  }, { threshold: 0.5 });

  zaehler.forEach((z) => beobachter.observe(z));
}

/* --------------------------------------------------------------------------
   Kontaktformular mit Validierung
   -------------------------------------------------------------------------- */
function initKontaktformular() {
  const formular = document.getElementById("kontaktformular");
  if (!formular) return;

  const erfolg = document.getElementById("formular-erfolg");

  const pruefungen = {
    name: (wert) => wert.trim().length >= 2 || "Bitte gib deinen Namen an (mind. 2 Zeichen).",
    email: (wert) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(wert.trim()) ||
      "Bitte gib eine gültige E-Mail-Adresse an.",
    telefon: (wert) =>
      wert.trim() === "" ||
      /^[0-9+\-\/\s()]{6,20}$/.test(wert.trim()) ||
      "Bitte gib eine gültige Telefonnummer an.",
    betreff: (wert) => wert !== "" || "Bitte wähle einen Betreff aus.",
    nachricht: (wert) =>
      wert.trim().length >= 10 || "Deine Nachricht sollte mindestens 10 Zeichen lang sein.",
    datenschutz: (_, feld) =>
      feld.checked || "Bitte stimme der Verarbeitung deiner Daten zu.",
  };

  function pruefeFeld(feld) {
    const pruefung = pruefungen[feld.name];
    if (!pruefung) return true;

    const ergebnis = pruefung(feld.value, feld);
    const feldContainer = feld.closest(".feld");
    const meldung = feldContainer.querySelector(".fehlermeldung");

    if (ergebnis === true) {
      feld.classList.remove("fehler");
      feldContainer.classList.remove("zeigt-fehler");
      return true;
    }

    feld.classList.add("fehler");
    feldContainer.classList.add("zeigt-fehler");
    if (meldung) meldung.textContent = ergebnis;
    return false;
  }

  // Direktes Feedback beim Verlassen eines Feldes
  formular.querySelectorAll("input, select, textarea").forEach((feld) => {
    feld.addEventListener("blur", () => pruefeFeld(feld));
    feld.addEventListener("input", () => {
      if (feld.classList.contains("fehler")) pruefeFeld(feld);
    });
  });

  formular.addEventListener("submit", (e) => {
    e.preventDefault();

    let allesGueltig = true;
    let erstesFehlerFeld = null;

    formular.querySelectorAll("input, select, textarea").forEach((feld) => {
      const gueltig = pruefeFeld(feld);
      if (!gueltig) {
        allesGueltig = false;
        if (!erstesFehlerFeld) erstesFehlerFeld = feld;
      }
    });

    if (!allesGueltig) {
      erstesFehlerFeld.focus();
      erstesFehlerFeld.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Nachricht als E-Mail-Entwurf öffnen (statische Website ohne Server).
    // Sobald ein Backend oder Formulardienst vorhanden ist, hier den
    // fetch()-Aufruf an den entsprechenden Endpunkt einsetzen.
    const daten = new FormData(formular);
    const betreffText = formular.querySelector('[name="betreff"] option:checked').textContent;
    const mailBetreff = encodeURIComponent(`[Website] ${betreffText} – ${daten.get("name")}`);
    const mailText = encodeURIComponent(
      `Name: ${daten.get("name")}\n` +
      `E-Mail: ${daten.get("email")}\n` +
      `Telefon: ${daten.get("telefon") || "–"}\n` +
      `Betreff: ${betreffText}\n\n` +
      `Nachricht:\n${daten.get("nachricht")}`
    );

    const empfaenger =
      document.querySelector('[data-cms-mail="email"]')?.textContent.trim() ||
      "info@mellis-krabbelzwerge.de";
    window.location.href =
      `mailto:${empfaenger}?subject=${mailBetreff}&body=${mailText}`;

    // Erfolgsmeldung anzeigen
    formular.style.display = "none";
    if (erfolg) {
      erfolg.style.display = "block";
      erfolg.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // "Neue Nachricht"-Knopf in der Erfolgsmeldung
  const nochmalKnopf = document.getElementById("formular-nochmal");
  if (nochmalKnopf) {
    nochmalKnopf.addEventListener("click", () => {
      formular.reset();
      formular.style.display = "";
      erfolg.style.display = "none";
      formular.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

/* --------------------------------------------------------------------------
   Google-Maps-Karte erst nach Einwilligung laden (Zwei-Klick-Lösung):
   ohne Klick fließen keine Daten an Google, und die Seite lädt schneller.
   -------------------------------------------------------------------------- */
function initKartenConsent() {
  const consent = document.getElementById("karten-consent");
  const knopf = document.getElementById("karte-laden");
  if (!consent || !knopf) return;

  knopf.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.google.com/maps?q=Im%20Looscheid%2082%2C%2045141%20Essen&output=embed&hl=de";
    iframe.title = "Google-Maps-Karte: Im Looscheid 82, 45141 Essen (Stoppenberg)";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer";
    iframe.allow = "fullscreen";

    consent.classList.remove("karten-consent");
    consent.classList.add("karten-rahmen");
    consent.replaceChildren(iframe);
  });
}
