/* ==========================================================================
   Melli's Krabbelzwerge – Bewertungen

   Zeigt die Bewertungen aus daten/bewertungen.json: Durchschnitt, Verteilung
   auf die fünf Sternstufen, Filter, Sortierung – und ein Formular, mit dem
   jeder Besucher eine eigene Bewertung abgeben kann.

   Zwei Dinge sind hier wichtig:
   · Alle Texte werden als Text eingesetzt (kein innerHTML). Was jemand ins
     Formular tippt, kann auf der Seite also nichts anrichten.
   · Fotos werden schon im Browser verkleinert. Ein Handyfoto hat schnell
     6 MB – über eine Mobilfunkverbindung hochgeladen dauert das ewig und
     der Raspberry Pi hätte drei davon gleichzeitig im Arbeitsspeicher.
   ========================================================================== */

(function () {
  "use strict";

  const QUELLE = "daten/bewertungen.json";
  const JE_SEITE = 5;              // so viele Bewertungen auf einmal
  const MAX_BILDER = 3;
  const MAX_KANTE = 1400;          // längste Bildkante nach dem Verkleinern
  const MAX_BILD_BYTES = 2.2 * 1024 * 1024;

  const halter = document.getElementById("bw-liste");
  if (!halter) return;             // Seite ohne Bewertungsbereich

  let alle = [];                   // alles, was der Server kennt
  let sichtbar = JE_SEITE;         // wie viele gerade angezeigt werden
  let filterSterne = "alle";
  let nurFotos = false;
  let sortierung = "neu";
  let gewaehlteBilder = [];        // Daten-URIs der ausgewählten Fotos

  /* ------------------------------ Werkzeuge ------------------------------- */

  function el(name, klasse, text) {
    const knoten = document.createElement(name);
    if (klasse) knoten.className = klasse;
    if (text !== undefined) knoten.textContent = text;
    return knoten;
  }

  function zahlFormat(wert, stellen) {
    return wert.toLocaleString("de-DE", {
      minimumFractionDigits: stellen, maximumFractionDigits: stellen,
    });
  }

  function langesDatum(zeitpunkt) {
    return zeitpunkt.toLocaleDateString("de-DE", {
      day: "numeric", month: "long", year: "numeric",
    });
  }

  function relativeZeit(zeitpunkt) {
    const tage = Math.floor((Date.now() - zeitpunkt.getTime()) / 86400000);
    if (tage <= 0) return "heute";
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

  /* Eine Reihe aus fünf Sternen; halbe Sterne gibt es bewusst nicht –
     stattdessen wird ab 0,5 aufgefüllt. */
  function sterneReihe(anzahl, klasse) {
    const reihe = el("div", "bw-sterne" + (klasse ? " " + klasse : ""));
    for (let i = 1; i <= 5; i += 1) {
      const stern = el("span", i <= Math.round(anzahl) ? "bw-stern voll" : "bw-stern", "★");
      reihe.appendChild(stern);
    }
    return reihe;
  }

  /* Ein Bildpfad darf nur auf eine eigene Datei zeigen – nie auf einen
     fremden Server und nie auf eine data:-Adresse. */
  function bildInOrdnung(pfad) {
    return typeof pfad === "string" &&
      /^(bilder|assets\/img)\/[A-Za-z0-9._-]{1,120}$/.test(pfad);
  }

  function saubereBewertung(eintrag) {
    if (!eintrag || typeof eintrag !== "object") return null;
    const sterne = Math.round(Number(eintrag.sterne));
    if (!(sterne >= 1 && sterne <= 5)) return null;
    const zeit = new Date(eintrag.zeit);
    return {
      id: String(eintrag.id || ""),
      name: String(eintrag.name || "Gast").slice(0, 60),
      ort: String(eintrag.ort || "").slice(0, 60),
      sterne,
      text: String(eintrag.text || "").slice(0, 2000),
      bilder: (Array.isArray(eintrag.bilder) ? eintrag.bilder : []).filter(bildInOrdnung),
      zeit: isNaN(zeit.getTime()) ? new Date() : zeit,
    };
  }

  /* ------------------------------ Übersicht ------------------------------- */

  function uebersichtZeichnen() {
    const rahmen = document.getElementById("bw-uebersicht");
    const werkzeuge = document.getElementById("bw-werkzeuge");
    if (!rahmen) return;

    if (!alle.length) {
      rahmen.hidden = true;
      if (werkzeuge) werkzeuge.hidden = true;
      return;
    }
    rahmen.hidden = false;
    if (werkzeuge) werkzeuge.hidden = alle.length < 3;   // lohnt sich erst dann

    const summe = alle.reduce((s, b) => s + b.sterne, 0);
    const schnitt = summe / alle.length;

    document.getElementById("bw-schnitt-zahl").textContent = zahlFormat(schnitt, 1);
    const sterneHalter = document.getElementById("bw-schnitt-sterne");
    sterneHalter.replaceChildren();
    Array.from(sterneReihe(schnitt).children).forEach((s) => sterneHalter.appendChild(s));
    document.getElementById("bw-schnitt-anzahl").textContent =
      alle.length === 1 ? "aus 1 Bewertung" : `aus ${alle.length} Bewertungen`;

    const verteilung = document.getElementById("bw-verteilung");
    verteilung.replaceChildren();
    for (let stufe = 5; stufe >= 1; stufe -= 1) {
      const anzahl = alle.filter((b) => b.sterne === stufe).length;
      const anteil = alle.length ? (anzahl / alle.length) * 100 : 0;

      const zeile = el("button", "bw-balken-zeile");
      zeile.type = "button";
      zeile.setAttribute("aria-label",
        `${anzahl} von ${alle.length} Bewertungen mit ${stufe} Sternen anzeigen`);
      zeile.appendChild(el("span", "bw-balken-stufe", stufe + " ★"));

      const spur = el("span", "bw-balken-spur");
      const fuellung = el("span", "bw-balken-fuellung");
      fuellung.style.width = anteil.toFixed(1) + "%";
      spur.appendChild(fuellung);
      zeile.appendChild(spur);
      zeile.appendChild(el("span", "bw-balken-zahl", String(anzahl)));

      zeile.addEventListener("click", () => {
        filterSterne = filterSterne === String(stufe) ? "alle" : String(stufe);
        chipsAktualisieren();
        sichtbar = JE_SEITE;
        listeZeichnen();
        halter.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      verteilung.appendChild(zeile);
    }
  }

  function chipsAktualisieren() {
    document.querySelectorAll("#bw-filter .bw-chip").forEach((chip) => {
      const aktiv = chip.dataset.sterne === filterSterne;
      chip.classList.toggle("aktiv", aktiv);
      chip.setAttribute("aria-pressed", aktiv ? "true" : "false");
    });
  }

  /* -------------------------------- Liste --------------------------------- */

  function gefiltert() {
    let liste = alle.slice();
    if (filterSterne !== "alle") {
      liste = liste.filter((b) => String(b.sterne) === filterSterne);
    }
    if (nurFotos) liste = liste.filter((b) => b.bilder.length);

    const nachZeit = (a, b) => b.zeit - a.zeit;
    if (sortierung === "alt") liste.sort((a, b) => a.zeit - b.zeit);
    else if (sortierung === "hoch") liste.sort((a, b) => b.sterne - a.sterne || nachZeit(a, b));
    else if (sortierung === "niedrig") liste.sort((a, b) => a.sterne - b.sterne || nachZeit(a, b));
    else liste.sort(nachZeit);
    return liste;
  }

  function karteBauen(bewertung) {
    const karte = el("article", "bw-karte einblenden");

    const kopf = el("header", "bw-karte-kopf");
    const zeichen = (bewertung.name.trim()[0] || "?").toUpperCase();
    const avatar = el("div", "bw-avatar", zeichen);
    // Immer dieselbe Farbe für denselben Namen – das wirkt ruhiger als Zufall.
    avatar.style.setProperty("--avatar-ton", (zeichen.charCodeAt(0) * 47) % 360 + "deg");
    kopf.appendChild(avatar);

    const wer = el("div", "bw-wer");
    wer.appendChild(el("strong", null, bewertung.name));
    if (bewertung.ort) wer.appendChild(el("span", "bw-ort", bewertung.ort));
    const zeit = el("time", "bw-zeit", relativeZeit(bewertung.zeit));
    zeit.dateTime = bewertung.zeit.toISOString();
    zeit.title = langesDatum(bewertung.zeit);
    wer.appendChild(zeit);
    kopf.appendChild(wer);

    const sterne = sterneReihe(bewertung.sterne);
    sterne.setAttribute("role", "img");
    sterne.setAttribute("aria-label", bewertung.sterne + " von 5 Sternen");
    kopf.appendChild(sterne);
    karte.appendChild(kopf);

    const text = el("div", "bw-text");
    String(bewertung.text).split(/\n{2,}/).map((a) => a.trim()).filter(Boolean)
      .forEach((absatz) => {
        const p = el("p");
        absatz.split("\n").forEach((zeile, i) => {
          if (i > 0) p.appendChild(document.createElement("br"));
          p.appendChild(document.createTextNode(zeile));
        });
        text.appendChild(p);
      });
    karte.appendChild(text);

    if (bewertung.bilder.length) {
      const bilder = el("div", "bw-bilder");
      bewertung.bilder.forEach((pfad, i) => {
        const knopf = el("button", "bw-bild-knopf");
        knopf.type = "button";
        const bild = document.createElement("img");
        bild.src = pfad;
        bild.alt = `Foto ${i + 1} zur Bewertung von ${bewertung.name}`;
        bild.loading = "lazy";
        bild.decoding = "async";
        knopf.appendChild(bild);
        knopf.addEventListener("click", () => lupeOeffnen(pfad, bild.alt));
        bilder.appendChild(knopf);
      });
      karte.appendChild(bilder);
    }

    return karte;
  }

  function listeZeichnen() {
    const liste = gefiltert();
    halter.replaceChildren();

    const treffer = document.getElementById("bw-treffer");
    if (treffer) {
      const gefiltertAktiv = filterSterne !== "alle" || nurFotos;
      treffer.hidden = !gefiltertAktiv || !alle.length;
      treffer.textContent = liste.length === 1
        ? "1 Bewertung passt zu eurer Auswahl."
        : `${liste.length} Bewertungen passen zu eurer Auswahl.`;
    }

    if (!liste.length) {
      halter.appendChild(el("p", "hinweis-zeile", alle.length
        ? "Zu dieser Auswahl gibt es noch keine Bewertung."
        : "Noch hat niemand bewertet – seid die Ersten! ⭐"));
    } else {
      liste.slice(0, sichtbar).forEach((b) => halter.appendChild(karteBauen(b)));
    }

    const mehr = document.getElementById("bw-mehr");
    if (mehr) {
      const rest = liste.length - sichtbar;
      mehr.hidden = rest <= 0;
      mehr.textContent = rest > 0
        ? `Weitere ${Math.min(rest, JE_SEITE)} von ${rest} Bewertungen zeigen`
        : "";
    }

    if (window.Mellis) window.Mellis.einblendungenAnmelden(halter);
    else halter.querySelectorAll(".einblenden").forEach((k) => k.classList.remove("einblenden"));
  }

  /* ------------------------------- Großansicht ---------------------------- */

  let lupe = null;

  function lupeOeffnen(pfad, beschriftung) {
    if (!lupe) {
      lupe = el("div", "bw-lupe");
      lupe.setAttribute("role", "dialog");
      lupe.setAttribute("aria-modal", "true");
      lupe.setAttribute("aria-label", "Foto in Großansicht");
      const schliessen = el("button", "bw-lupe-schliessen", "✕");
      schliessen.type = "button";
      schliessen.setAttribute("aria-label", "Großansicht schließen");
      const bild = document.createElement("img");
      lupe.appendChild(schliessen);
      lupe.appendChild(bild);
      lupe.addEventListener("click", (e) => {
        if (e.target === lupe || e.target === schliessen) lupeSchliessen();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lupe.classList.contains("offen")) lupeSchliessen();
      });
      document.body.appendChild(lupe);
    }
    const bild = lupe.querySelector("img");
    bild.src = pfad;
    bild.alt = beschriftung || "";
    lupe.classList.add("offen");
    document.body.style.overflow = "hidden";
    lupe.querySelector(".bw-lupe-schliessen").focus();
  }

  function lupeSchliessen() {
    if (!lupe) return;
    lupe.classList.remove("offen");
    document.body.style.overflow = "";
  }

  /* -------------------------------- Formular ------------------------------ */

  function meldung(text, art) {
    const kasten = document.getElementById("bw-meldung");
    if (!kasten) return;
    kasten.textContent = text;
    kasten.className = "bw-meldung" + (art ? " " + art : "");
    kasten.style.display = text ? "block" : "none";
  }

  /* Foto im Browser verkleinern: spart Ladezeit und schont den kleinen
     Server. Klappt das nicht (sehr alter Browser), wird die Datei so
     genommen, wie sie ist – solange sie nicht zu groß ist. */
  function bildVerkleinern(datei) {
    return new Promise((fertig, fehler) => {
      const leser = new FileReader();
      leser.onerror = () => fehler(new Error("Das Foto konnte nicht gelesen werden."));
      leser.onload = () => {
        const bild = new Image();
        bild.onerror = () => fehler(new Error("Das ist kein gültiges Foto."));
        bild.onload = () => {
          try {
            const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
            const breite = Math.max(1, Math.round(bild.width * faktor));
            const hoehe = Math.max(1, Math.round(bild.height * faktor));
            const flaeche = document.createElement("canvas");
            flaeche.width = breite;
            flaeche.height = hoehe;
            const stift = flaeche.getContext("2d");
            stift.drawImage(bild, 0, 0, breite, hoehe);

            let ergebnis = flaeche.toDataURL("image/jpeg", 0.82);
            // Immer noch zu groß? Dann noch einmal deutlich sparsamer.
            if (ergebnis.length * 0.75 > MAX_BILD_BYTES) {
              ergebnis = flaeche.toDataURL("image/jpeg", 0.6);
            }
            fertig(ergebnis);
          } catch {
            fertig(leser.result);
          }
        };
        bild.src = leser.result;
      };
      leser.readAsDataURL(datei);
    });
  }

  function vorschauZeichnen() {
    const rahmen = document.getElementById("bw-vorschau");
    const name = document.getElementById("bw-bilder-name");
    if (!rahmen) return;

    rahmen.replaceChildren();
    gewaehlteBilder.forEach((datenUri, stelle) => {
      const kachel = el("div", "bw-vorschau-kachel");
      const bild = document.createElement("img");
      bild.src = datenUri;
      bild.alt = "Ausgewähltes Foto " + (stelle + 1);
      kachel.appendChild(bild);

      const weg = el("button", "bw-vorschau-weg", "✕");
      weg.type = "button";
      weg.setAttribute("aria-label", `Foto ${stelle + 1} wieder entfernen`);
      weg.addEventListener("click", () => {
        gewaehlteBilder.splice(stelle, 1);
        vorschauZeichnen();
      });
      kachel.appendChild(weg);
      rahmen.appendChild(kachel);
    });

    if (name) {
      name.textContent = gewaehlteBilder.length
        ? `${gewaehlteBilder.length} von ${MAX_BILDER} Fotos ausgewählt`
        : "Keine Fotos ausgewählt";
    }
  }

  function formularVorbereiten() {
    const formular = document.getElementById("bw-formular");
    if (!formular) return;

    /* Sterne: der gewählte Wert wird gleich in Worten bestätigt. */
    const worte = {
      1: "1 Stern – schade, das tut uns leid",
      2: "2 Sterne – da geht noch was",
      3: "3 Sterne – in Ordnung",
      4: "4 Sterne – richtig gut",
      5: "5 Sterne – rundum glücklich",
    };
    formular.querySelectorAll('input[name="sterne"]').forEach((feld) => {
      feld.addEventListener("change", () => {
        const text = document.getElementById("bw-sterne-text");
        if (text) text.textContent = worte[feld.value] || "";
      });
    });

    const textfeld = document.getElementById("bw-text");
    const zaehler = document.getElementById("bw-zaehler");
    if (textfeld && zaehler) {
      textfeld.addEventListener("input", () => {
        zaehler.textContent = `${textfeld.value.length} / 2000 Zeichen`;
      });
    }

    const dateifeld = document.getElementById("bw-bilder");
    if (dateifeld) {
      dateifeld.addEventListener("change", async () => {
        const dateien = Array.from(dateifeld.files || []);
        dateifeld.value = "";                 // dieselbe Datei erneut wählbar
        if (!dateien.length) return;

        if (gewaehlteBilder.length + dateien.length > MAX_BILDER) {
          meldung(`Bitte höchstens ${MAX_BILDER} Fotos – ihr könnt einzelne wieder entfernen.`, "fehler");
          return;
        }
        meldung("Fotos werden vorbereitet …", "");
        try {
          for (const datei of dateien) {
            if (!/^image\/(png|jpe?g|webp)$/.test(datei.type)) {
              throw new Error("Erlaubt sind Fotos als JPG, PNG oder WebP.");
            }
            gewaehlteBilder.push(await bildVerkleinern(datei));
          }
          vorschauZeichnen();
          meldung("", "");
        } catch (fehler) {
          meldung(fehler.message || "Das Foto konnte nicht gelesen werden.", "fehler");
        }
      });
    }

    formular.addEventListener("submit", async (e) => {
      e.preventDefault();
      const knopf = document.getElementById("bw-senden");
      const gewaehlt = formular.querySelector('input[name="sterne"]:checked');
      const name = document.getElementById("bw-name").value.trim();
      const text = textfeld ? textfeld.value.trim() : "";

      if (!gewaehlt) return meldung("Bitte vergebt zuerst Sterne.", "fehler");
      if (!name) return meldung("Bitte tragt einen Namen ein.", "fehler");
      if (text.length < 5) return meldung("Bitte schreibt noch ein paar Worte dazu.", "fehler");
      const einwilligung = document.getElementById("bw-einwilligung");
      if (einwilligung && !einwilligung.checked) {
        // Ohne dieses Häkchen fehlt die Rechtsgrundlage für die
        // Veröffentlichung – die Bewertung darf gar nicht erst losgeschickt werden.
        return meldung("Bitte bestätigt noch, dass eure Bewertung öffentlich erscheinen darf.", "fehler");
      }

      knopf.disabled = true;
      meldung("Bewertung wird gesendet …", "");

      try {
        const antwort = await fetch("api/bewertung", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ort: document.getElementById("bw-ort").value.trim(),
            sterne: Number(gewaehlt.value),
            text,
            bilder: gewaehlteBilder,
            webseite: document.getElementById("bw-webseite").value,
          }),
        });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) throw new Error(daten.fehler || "Das hat leider nicht geklappt.");

        const neue = saubereBewertung(daten.bewertung);
        if (neue) {
          alle.unshift(neue);
          filterSterne = "alle";
          nurFotos = false;
          sortierung = "neu";
          const schalter = document.getElementById("bw-nur-fotos");
          const auswahl = document.getElementById("bw-sortierung");
          if (schalter) schalter.checked = false;
          if (auswahl) auswahl.value = "neu";
          chipsAktualisieren();
          sichtbar = JE_SEITE;
          uebersichtZeichnen();
          listeZeichnen();
        }

        formular.reset();
        gewaehlteBilder = [];
        vorschauZeichnen();
        const sterneText = document.getElementById("bw-sterne-text");
        if (sterneText) sterneText.textContent = "Bitte wählt eine Bewertung";
        if (zaehler) zaehler.textContent = "0 / 2000 Zeichen";
        meldung("Herzlichen Dank für eure Bewertung! Sie steht jetzt oben in der Liste. 💛", "erfolg");
      } catch (fehler) {
        meldung(fehler.message ||
          "Die Bewertung konnte nicht gesendet werden. Bitte versucht es später noch einmal.", "fehler");
      } finally {
        knopf.disabled = false;
      }
    });
  }

  /* ------------------------------ Bedienelemente -------------------------- */

  function werkzeugeVorbereiten() {
    document.querySelectorAll("#bw-filter .bw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filterSterne = chip.dataset.sterne;
        chipsAktualisieren();
        sichtbar = JE_SEITE;
        listeZeichnen();
      });
    });

    const schalter = document.getElementById("bw-nur-fotos");
    if (schalter) {
      schalter.addEventListener("change", () => {
        nurFotos = schalter.checked;
        sichtbar = JE_SEITE;
        listeZeichnen();
      });
    }

    const auswahl = document.getElementById("bw-sortierung");
    if (auswahl) {
      auswahl.addEventListener("change", () => {
        sortierung = auswahl.value;
        sichtbar = JE_SEITE;
        listeZeichnen();
      });
    }

    const mehr = document.getElementById("bw-mehr");
    if (mehr) {
      mehr.addEventListener("click", () => {
        sichtbar += JE_SEITE;
        listeZeichnen();
      });
    }
  }

  /* --------------------------------- Start -------------------------------- */

  function laden() {
    werkzeugeVorbereiten();
    formularVorbereiten();

    fetch(QUELLE)
      .then((antwort) => (antwort.ok ? antwort.json() : []))
      .then((daten) => {
        alle = (Array.isArray(daten) ? daten : [])
          .map(saubereBewertung)
          .filter(Boolean)
          .sort((a, b) => b.zeit - a.zeit);
      })
      .catch(() => { alle = []; })
      .then(() => {
        uebersichtZeichnen();
        listeZeichnen();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", laden);
  } else {
    laden();
  }
})();
