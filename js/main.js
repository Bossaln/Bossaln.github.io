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

  window.addEventListener("scroll", () => {
    knopf.classList.toggle("sichtbar", window.scrollY > 450);
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
        eintrag.target.classList.add("sichtbar");
        beobachter.unobserve(eintrag.target);
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

  function tippe(el) {
    const text = el.textContent;
    el.textContent = "";
    el.classList.add("tippt");
    let i = 0;

    const intervall = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(intervall);
        // Cursor nach kurzem Nachblinken ausblenden
        setTimeout(() => el.classList.remove("tippt"), 1600);
      }
    }, 38);
  }

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

/* --------------------------------------------------------------------------
   Akkordeon (FAQ, Eingewöhnung)
   -------------------------------------------------------------------------- */
function initAkkordeon() {
  document.querySelectorAll(".akkordeon-punkt").forEach((punkt) => {
    const frage = punkt.querySelector(".akkordeon-frage");
    const antwort = punkt.querySelector(".akkordeon-antwort");
    if (!frage || !antwort) return;

    frage.addEventListener("click", () => {
      const istOffen = punkt.classList.contains("offen");

      // andere Punkte im selben Akkordeon schließen
      punkt.closest(".akkordeon")
        .querySelectorAll(".akkordeon-punkt.offen")
        .forEach((anderer) => {
          anderer.classList.remove("offen");
          anderer.querySelector(".akkordeon-antwort").style.maxHeight = null;
          anderer.querySelector(".akkordeon-frage").setAttribute("aria-expanded", "false");
        });

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
  if (!zaehler.length || !("IntersectionObserver" in window)) {
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

    window.location.href =
      `mailto:info@mellis-krabbelzwerge.de?subject=${mailBetreff}&body=${mailText}`;

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
