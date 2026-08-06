/* ==========================================================================
   Melli's Krabbelzwerge – Bedienung und Bewegung

   Enthält alles, was auf jeder Seite gebraucht wird:
   Navigation, „Nach oben"-Knopf, Akkordeon, Kontaktformular sowie die
   Animationen (Einblenden beim Scrollen, Zahlen hochzählen, Schreibmaschine).

   Die Animationen laufen über motion.dev (js/vendor/motion.min.js). Dessen
   animate() nutzt die Web-Animations-API: die Bewegung wird einmal an den
   Browser übergeben und danach von der Grafikeinheit berechnet. Es läuft
   also kein JavaScript mehr pro Einzelbild – dadurch bleibt die Seite auch
   auf schwachen Geräten flüssig, selbst wenn nebenher noch Bilder laden.

   Fehlt motion.dev oder wünscht das Gerät „Bewegung reduzieren", wird
   einfach nicht animiert. Alle Inhalte sind dann von Anfang an sichtbar.
   ========================================================================== */

(function () {
  "use strict";

  const wurzel = document.documentElement;

  /* motion.dev vorhanden? Sonst läuft die Seite ganz ohne Animationen. */
  const motion =
    window.Motion && typeof window.Motion.animate === "function" ? window.Motion : null;

  /* Die Klasse „bewegung" setzt ein winziges Skript im Kopf der Seite, noch
     bevor irgendetwas gezeichnet wird. Nur dann starten Elemente unsichtbar.
     Hier wird sie wieder entfernt, falls motion.dev doch nicht da ist. */
  const bewegung = wurzel.classList.contains("bewegung") && Boolean(motion);
  if (!bewegung) wurzel.classList.remove("bewegung");

  /* Der Kopf der Seite hat eine Notbremse gestellt, die nach ein paar
     Sekunden alles sichtbar macht, falls dieses Skript gar nicht ankommt.
     Es ist angekommen – Notbremse lösen. */
  if (window.mellisNotbremse) {
    clearTimeout(window.mellisNotbremse);
    window.mellisNotbremse = null;
  }

  /* Dieselbe Kurve, die das Stylesheet früher als „ease" verwendet hat –
     damit sich die Bewegungen exakt so anfühlen wie vorher. */
  const EASE = [0.25, 0.1, 0.25, 1];

  /* --------------------------------------------------------------------------
     Kleiner, sturzsicherer Aufruf von motion.dev
     Liefert immer ein Promise, auch wenn die Animation nicht starten konnte.
     -------------------------------------------------------------------------- */
  function animiere(el, bilder, optionen) {
    if (!bewegung) return Promise.resolve(false);
    try {
      const lauf = motion.animate(el, bilder, optionen);
      if (lauf && lauf.finished && typeof lauf.finished.then === "function") {
        return lauf.finished.then(() => true, () => false);
      }
    } catch (fehler) {
      /* Lieber gar keine Animation als eine kaputte Seite */
    }
    return Promise.resolve(false);
  }

  /* --------------------------------------------------------------------------
     Einblenden beim Scrollen
     -------------------------------------------------------------------------- */

  /* Woher ein Element hereingleitet. Bewusst dieselben Regeln wie früher im
     Stylesheet, nur an einer Stelle gebündelt. */
  const RICHTUNGEN = [
    [".zweispaltig > .einblenden:first-child", "translateX(-36px)"],
    [".zweispaltig > .einblenden:last-child", "translateX(36px)"],
    [".zeit-punkt", "translateX(-36px)"],
    [".ordner-karte", "translateY(18px) scale(0.94)"],
    [".cta-banner", "translateY(22px) scale(0.97)"],
  ];

  function startpunkt(el) {
    // Ab 900 px liegt der Zeitstrahl mittig; die rechten Karten kommen von rechts.
    if (el.matches(".zeit-punkt:nth-child(even)") &&
        window.matchMedia("(min-width: 900px)").matches) {
      return "translateX(36px)";
    }
    for (const [wahl, wert] of RICHTUNGEN) {
      if (el.matches(wahl)) return wert;
    }
    return "translateY(30px)";
  }

  function einblenden(el, verzoegerung) {
    // Für die Dauer der Bewegung eine eigene Grafikebene anfordern – nur
    // für dieses eine Element, nicht für alle auf der Seite.
    el.style.willChange = "opacity, transform";

    // Aufräumen: Klasse weg (der unsichtbare Startzustand hängt daran),
    // Inline-Werte weg, Grafikebene wieder freigeben.
    const aufraeumen = () => {
      el.classList.remove("einblenden");
      el.style.opacity = "";
      el.style.transform = "";
      el.style.willChange = "";
    };

    animiere(
      el,
      { opacity: [0, 1], transform: [startpunkt(el), "none"] },
      { duration: 0.7, delay: verzoegerung, ease: EASE }
    ).then(aufraeumen, aufraeumen);
  }

  /* Ein Beobachter für die ganze Seite. „rootMargin" statt „threshold":
     eine Karte, die höher ist als das Fenster, erreicht nie 12 % Sichtbarkeit
     und wäre früher unsichtbar hängen geblieben. Deshalb gab es bisher einen
     Notfall-Timer nach zwei Sekunden – der ist damit überflüssig. */
  let beobachter = null;
  let laufendeNummer = 0;

  function beobachterHolen() {
    if (beobachter || !("IntersectionObserver" in window)) return beobachter;
    beobachter = new IntersectionObserver((eintraege) => {
      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;
        const el = eintrag.target;
        beobachter.unobserve(el);
        einblenden(el, Number(el.dataset.einblendStufe || 0) * 0.09);
      }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0 });
    return beobachter;
  }

  /* Meldet alle .einblenden-Elemente unterhalb von „bereich" an. Wird auch
     von galerie.js und bewertungen.js für nachgeladene Karten aufgerufen. */
  function einblendungenAnmelden(bereich) {
    const elemente = (bereich || document).querySelectorAll(".einblenden");
    if (!elemente.length) return;

    if (!bewegung) {
      elemente.forEach((el) => el.classList.remove("einblenden"));
      return;
    }

    const augen = beobachterHolen();
    if (!augen) {
      elemente.forEach((el) => el.classList.remove("einblenden"));
      return;
    }

    elemente.forEach((el) => {
      // Gestaffelt: je vier Karten laufen um 90 ms versetzt los
      el.dataset.einblendStufe = String(laufendeNummer++ % 4);
      augen.observe(el);
    });
  }

  /* --------------------------------------------------------------------------
     Mobile Navigation (Hamburger-Menü)
     -------------------------------------------------------------------------- */
  function initNavigation() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (!toggle || !links) return;

    function setzen(offen) {
      links.classList.toggle("offen", offen);
      toggle.setAttribute("aria-expanded", offen ? "true" : "false");
      toggle.setAttribute("aria-label", offen ? "Menü schließen" : "Menü öffnen");
    }

    toggle.addEventListener("click", () => {
      setzen(!links.classList.contains("offen"));
    });

    links.addEventListener("click", (e) => {
      if (e.target.closest("a")) setzen(false);
    });

    document.addEventListener("click", (e) => {
      if (!links.contains(e.target) && !toggle.contains(e.target)) setzen(false);
    });

    // Mit Escape schließen und den Fokus zurück auf den Knopf
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && links.classList.contains("offen")) {
        setzen(false);
        toggle.focus();
      }
    });
  }

  /* --------------------------------------------------------------------------
     "Nach oben"-Knopf

     Der Scroll-Zustand wird nur einmal pro Einzelbild ausgewertet. Vorher lief
     bei jedem einzelnen Scroll-Ereignis ein classList-Aufruf – auf dem Handy
     sind das schnell mehrere hundert pro Sekunde, und jeder davon konnte den
     Browser zwingen, das Layout neu zu vermessen.
     -------------------------------------------------------------------------- */
  function initNachObenKnopf() {
    const knopf = document.querySelector(".nach-oben");
    if (!knopf) return;

    let geplant = false;
    let sichtbar = false;

    function pruefen() {
      geplant = false;
      const sollSichtbar = window.scrollY > 450;
      if (sollSichtbar === sichtbar) return;
      sichtbar = sollSichtbar;
      knopf.classList.toggle("sichtbar", sichtbar);
    }

    window.addEventListener("scroll", () => {
      if (geplant) return;
      geplant = true;
      requestAnimationFrame(pruefen);
    }, { passive: true });

    knopf.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: bewegung ? "smooth" : "auto" });
    });

    pruefen();
  }

  /* --------------------------------------------------------------------------
     Schreibmaschinen-Effekt

     Zwei Änderungen gegenüber früher:
     · Die Zeichen kommen jetzt im Takt des Bildschirms (requestAnimationFrame)
       statt über setInterval. Ein Intervall feuert auch mitten zwischen zwei
       Bildern und erzwingt dann eine zusätzliche Layout-Berechnung – genau das
       ließ den Text vorher zittern.
     · Die Höhe des Absatzes wird vorher gemessen und festgehalten. Sonst
       springt beim Tippen alles darunter, sobald eine neue Zeile beginnt.
     -------------------------------------------------------------------------- */
  function initSchreibmaschine() {
    const elemente = document.querySelectorAll("[data-tippen]");
    if (!elemente.length || !bewegung || !("IntersectionObserver" in window)) return;

    const TAKT = 38; // Millisekunden je Zeichen – wie gehabt

    function tippe(el) {
      const text = el.textContent;
      if (!text.trim()) return;

      // Platz reservieren, damit nichts springt
      const hoehe = el.getBoundingClientRect().height;
      if (hoehe) el.style.minHeight = hoehe + "px";

      el.textContent = "";
      el.classList.add("tippt");

      const start = performance.now();
      let gezeigt = 0;

      function schritt(jetzt) {
        const soll = Math.min(Math.floor((jetzt - start) / TAKT), text.length);
        // Nur schreiben, wenn wirklich ein Zeichen dazugekommen ist
        if (soll !== gezeigt) {
          gezeigt = soll;
          el.textContent = text.slice(0, gezeigt);
        }
        if (gezeigt < text.length) {
          requestAnimationFrame(schritt);
          return;
        }
        setTimeout(() => {
          el.classList.remove("tippt");
          el.style.minHeight = "";
        }, 1600);
      }

      requestAnimationFrame(schritt);
    }

    const augen = new IntersectionObserver((eintraege) => {
      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;
        augen.unobserve(eintrag.target);
        tippe(eintrag.target);
      }
    }, { threshold: 0.6 });

    elemente.forEach((el) => augen.observe(el));
  }

  /* --------------------------------------------------------------------------
     Akkordeon (FAQ, Eingewöhnung)

     Die Höhe wird jetzt echt animiert statt über „max-height" auf einen
     geschätzten Wert. Das alte Verfahren wirkte am Anfang zäh und am Ende
     abgehackt, weil der Übergang bereits fertig war, bevor die Antwort
     ihre volle Höhe erreicht hatte.
     -------------------------------------------------------------------------- */
  function initAkkordeon() {
    const punkte = document.querySelectorAll(".akkordeon-punkt");
    if (!punkte.length) return;

    let nummer = 0;

    punkte.forEach((punkt) => {
      const frage = punkt.querySelector(".akkordeon-frage");
      const antwort = punkt.querySelector(".akkordeon-antwort");
      if (!frage || !antwort) return;

      // Vorlesegeräte sollen wissen, welcher Text zu welcher Frage gehört
      nummer += 1;
      if (!antwort.id) antwort.id = "akkordeon-antwort-" + nummer;
      if (!frage.id) frage.id = "akkordeon-frage-" + nummer;
      frage.setAttribute("aria-controls", antwort.id);
      if (!frage.hasAttribute("aria-expanded")) frage.setAttribute("aria-expanded", "false");
      antwort.setAttribute("role", "region");
      antwort.setAttribute("aria-labelledby", frage.id);

      frage.addEventListener("click", () => {
        const warOffen = punkt.classList.contains("offen");

        // Andere Punkte desselben Akkordeons zuklappen
        const akkordeon = punkt.closest(".akkordeon") || document;
        akkordeon.querySelectorAll(".akkordeon-punkt.offen").forEach(zuklappen);

        if (!warOffen) aufklappen(punkt);
      });
    });

    function aufklappen(punkt) {
      const frage = punkt.querySelector(".akkordeon-frage");
      const antwort = punkt.querySelector(".akkordeon-antwort");

      punkt.classList.add("offen");
      frage.setAttribute("aria-expanded", "true");

      if (!bewegung) {
        antwort.style.height = "auto";
        return;
      }

      const ziel = antwort.scrollHeight;
      animiere(antwort, { height: ["0px", ziel + "px"] }, { duration: 0.4, ease: EASE })
        .then((geklappt) => {
          // Danach „auto": so passt sich die Höhe an, wenn sich das Fenster
          // dreht oder die Schrift nachgeladen wird.
          if (punkt.classList.contains("offen")) antwort.style.height = "auto";
          else if (!geklappt) antwort.style.height = "";
        });
    }

    function zuklappen(punkt) {
      const frage = punkt.querySelector(".akkordeon-frage");
      const antwort = punkt.querySelector(".akkordeon-antwort");

      const von = antwort.getBoundingClientRect().height;
      punkt.classList.remove("offen");
      frage.setAttribute("aria-expanded", "false");

      if (!bewegung) {
        antwort.style.height = "";
        return;
      }

      animiere(antwort, { height: [von + "px", "0px"] }, { duration: 0.4, ease: EASE })
        .then(() => {
          if (!punkt.classList.contains("offen")) antwort.style.height = "";
        });
    }
  }

  /* --------------------------------------------------------------------------
     Zahlen hochzählen (Fakten-Bereich)
     -------------------------------------------------------------------------- */
  function initZaehler() {
    const zaehler = document.querySelectorAll("[data-ziel]");
    if (!zaehler.length) return;

    function sofort() {
      zaehler.forEach((z) => { z.textContent = z.dataset.ziel; });
    }

    if (!bewegung || !("IntersectionObserver" in window)) return sofort();

    const augen = new IntersectionObserver((eintraege) => {
      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;
        augen.unobserve(eintrag.target);
        hochzaehlen(eintrag.target);
      }
    }, { threshold: 0.5 });

    zaehler.forEach((z) => augen.observe(z));

    function hochzaehlen(el) {
      const ziel = parseInt(el.dataset.ziel, 10);
      if (!Number.isFinite(ziel)) return;

      const dauer = 1400;
      const start = performance.now();
      let gezeigt = null;

      function schritt(jetzt) {
        const fortschritt = Math.min((jetzt - start) / dauer, 1);
        // sanftes Abbremsen am Ende
        const wert = Math.round(ziel * (1 - Math.pow(1 - fortschritt, 3)));
        // Nur schreiben, wenn sich die Zahl wirklich geändert hat: bei „2"
        // wären es sonst über achtzig überflüssige Layout-Berechnungen.
        if (wert !== gezeigt) {
          gezeigt = wert;
          el.textContent = wert;
        }
        if (fortschritt < 1) requestAnimationFrame(schritt);
      }

      requestAnimationFrame(schritt);
    }
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
        /^[0-9+\-/\s()]{6,20}$/.test(wert.trim()) ||
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

      const feldContainer = feld.closest(".feld");
      if (!feldContainer) return true;

      const ergebnis = pruefung(feld.value, feld);
      const meldung = feldContainer.querySelector(".fehlermeldung");

      if (ergebnis === true) {
        feld.classList.remove("fehler");
        feld.removeAttribute("aria-invalid");
        feldContainer.classList.remove("zeigt-fehler");
        return true;
      }

      feld.classList.add("fehler");
      feld.setAttribute("aria-invalid", "true");
      feldContainer.classList.add("zeigt-fehler");
      if (meldung) meldung.textContent = ergebnis;
      return false;
    }

    const felder = formular.querySelectorAll("input, select, textarea");

    felder.forEach((feld) => {
      feld.addEventListener("blur", () => pruefeFeld(feld));
      feld.addEventListener("input", () => {
        if (feld.classList.contains("fehler")) pruefeFeld(feld);
      });
    });

    formular.addEventListener("submit", (e) => {
      e.preventDefault();

      let erstesFehlerFeld = null;
      felder.forEach((feld) => {
        if (!pruefeFeld(feld) && !erstesFehlerFeld) erstesFehlerFeld = feld;
      });

      if (erstesFehlerFeld) {
        // Erst scrollen, dann den Fokus setzen – sonst springt der Browser
        // selbst noch einmal und der weiche Scroll wird abgebrochen.
        erstesFehlerFeld.scrollIntoView({
          behavior: bewegung ? "smooth" : "auto",
          block: "center",
        });
        erstesFehlerFeld.focus({ preventScroll: true });
        return;
      }

      /* Die Anfrage geht an den eigenen Server, der daraus eine E-Mail
         baut und verschickt. Klappt das nicht – etwa weil die Seite ohne
         Server läuft oder der Mailversand streikt –, öffnet sich wie
         bisher das E-Mail-Programm der Besucher. So geht keine Nachricht
         verloren. */
      const daten = new FormData(formular);
      const gewaehlt = formular.querySelector('[name="betreff"] option:checked');
      const betreffText = gewaehlt ? gewaehlt.textContent.trim() : "Anfrage";
      const knopf = formular.querySelector('button[type="submit"]');

      function mailProgrammOeffnen() {
        const mailBetreff = encodeURIComponent(`[Website] ${betreffText} – ${daten.get("name")}`);
        const mailText = encodeURIComponent(
          `Name: ${daten.get("name")}\n` +
          `E-Mail: ${daten.get("email")}\n` +
          `Telefon: ${daten.get("telefon") || "–"}\n` +
          `Betreff: ${betreffText}\n\n` +
          `Nachricht:\n${daten.get("nachricht")}`
        );
        const feld = document.querySelector('[data-cms-mail="email"]');
        const empfaenger = (feld && feld.textContent.trim()) || "info@mellis-krabbelzwerge.de";
        window.location.href = `mailto:${empfaenger}?subject=${mailBetreff}&body=${mailText}`;
      }

      function fertigMelden() {
        formular.style.display = "none";
        if (erfolg) {
          erfolg.style.display = "block";
          erfolg.scrollIntoView({ behavior: bewegung ? "smooth" : "auto", block: "center" });
        }
      }

      const ursprungstext = knopf ? knopf.textContent : "";
      if (knopf) {
        knopf.disabled = true;
        knopf.textContent = "Wird gesendet …";
      }

      fetch("api/kontakt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: daten.get("name"),
          email: daten.get("email"),
          telefon: daten.get("telefon") || "",
          betreff: daten.get("betreff"),
          nachricht: daten.get("nachricht"),
          datenschutz: formular.querySelector("#datenschutz").checked,
          webseite: daten.get("webseite") || "",
        }),
      })
        .then((antwort) => antwort.json().catch(() => ({})).then((inhalt) => ({ antwort, inhalt })))
        .then(({ antwort, inhalt }) => {
          if (antwort.ok) return fertigMelden();
          if (inhalt.mailto) {              // Server kann nicht verschicken
            mailProgrammOeffnen();
            return fertigMelden();
          }
          throw new Error(inhalt.fehler || "Das hat leider nicht geklappt.");
        })
        .catch((fehler) => {
          // Keine Schnittstelle erreichbar (z. B. statisches Hosting):
          // dann übernimmt wie früher das E-Mail-Programm.
          if (fehler instanceof TypeError) {
            mailProgrammOeffnen();
            return fertigMelden();
          }
          window.alert(fehler.message +
            "\n\nBitte versucht es später noch einmal oder ruft uns einfach an.");
        })
        .then(() => {
          if (knopf) {
            knopf.disabled = false;
            knopf.textContent = ursprungstext;
          }
        });
    });

    const nochmalKnopf = document.getElementById("formular-nochmal");
    if (nochmalKnopf) {
      nochmalKnopf.addEventListener("click", () => {
        formular.reset();
        formular.querySelectorAll(".zeigt-fehler").forEach((f) => f.classList.remove("zeigt-fehler"));
        formular.querySelectorAll(".fehler").forEach((f) => {
          f.classList.remove("fehler");
          f.removeAttribute("aria-invalid");
        });
        formular.style.display = "";
        if (erfolg) erfolg.style.display = "none";
        formular.scrollIntoView({ behavior: bewegung ? "smooth" : "auto", block: "start" });
      });
    }
  }

  /* --------------------------------------------------------------------------
     Start – und eine kleine Schnittstelle für galerie.js und bewertungen.js,
     damit auch nachgeladene Karten sauber eingeblendet werden.
     -------------------------------------------------------------------------- */
  window.Mellis = {
    bewegung: bewegung,
    animiere: animiere,
    einblendungenAnmelden: einblendungenAnmelden,
    ease: EASE,
  };

  function start() {
    initNavigation();
    initNachObenKnopf();
    initAkkordeon();
    initZaehler();
    initKontaktformular();
    einblendungenAnmelden(document);

    // Die Schreibmaschine erst starten, wenn cms.js die veröffentlichten
    // Texte gesetzt hat – sonst tippt sie den Text aus der HTML-Datei ab und
    // der im Portal gepflegte Satz erscheint danach schlagartig.
    let getippt = false;
    function schreibmaschineStarten() {
      if (getippt) return;
      getippt = true;
      initSchreibmaschine();
    }
    document.addEventListener("cms-fertig", schreibmaschineStarten, { once: true });
    // Falls cms.js fehlt oder sehr lange braucht: trotzdem losschreiben
    setTimeout(schreibmaschineStarten, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
