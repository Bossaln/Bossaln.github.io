/* ==========================================================================
   Melli's Krabbelzwerge – Verwaltungs-Portal

   Sicherheit:
   - Anmeldung über PBKDF2-SHA256-Hash-Vergleich (WebCrypto, konstante Zeit),
     Zugangsdatei wird vor Verwendung auf Plausibilität geprüft
   - Sperre nach Fehlversuchen (zusätzlich im Arbeitsspeicher gespiegelt),
     Sitzungs-Ende nach Inaktivität und absolutes Sitzungs-Maximum
   - Clickjacking-Schutz (frame-ancestors wirkt nicht als Meta-Tag),
     Trusted-Types-kompatibel: keinerlei HTML-String-Injektion ins DOM

   Dynamik:
   - Das Portal liest die Website bei jeder Anmeldung selbst ein und erkennt
     alle bearbeitbaren Texte (data-cms/-html) und Bilder (data-cms-bild)
     automatisch – neue Felder erscheinen ohne Pflege einer Feldliste
   - Live-Vorschau aller Seiten inklusive unveröffentlichter Änderungen

   Bearbeitung: Inhalte werden lokal gespeichert (Sofort-Vorschau) und zum
   Veröffentlichen als Datei exportiert.
   ========================================================================== */

(function () {
  "use strict";

  /* Clickjacking-Schutz: Das Portal darf nicht in fremde Seiten eingebettet
     werden. Die CSP-Direktive frame-ancestors wird in Meta-Tags von Browsern
     ignoriert, deshalb wird die Einbettung hier erkannt und aufgelöst. */
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try {
      window.top.location.href = window.self.location.href;
    } catch {
      window.location.replace("about:blank");
    }
    return;
  }

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";
  const SITZUNG_SCHLUESSEL = "mellis_admin_sitzung";
  const VERSUCHE_SCHLUESSEL = "mellis_admin_versuche";
  const SITZUNG_MINUTEN = 30;        // Ende nach Inaktivität
  const SITZUNG_MAX_STUNDEN = 8;     // absolutes Sitzungs-Maximum
  const MAX_VERSUCHE = 5;
  const NEUE_ITERATIONEN = 600000;   // PBKDF2-Runden für neue Passwörter (OWASP-Empfehlung)

  // Schnellzugriff-Felder mit eigenen Karten im Portal
  const FELDER = ["slogan", "zeit_mo_do", "zeit_fr", "zeit_sa_so", "telefon", "email"];

  // Seiten, die das Portal einliest (Quelle für Felder, Bilder und Vorschau)
  const SEITEN = [
    { datei: "index.html", name: "Startseite" },
    { datei: "ueber-uns.html", name: "Über uns" },
    { datei: "tagesablauf.html", name: "Tagesablauf" },
    { datei: "galerie.html", name: "Galerie" },
    { datei: "kontakt.html", name: "Kontakt" },
    { datei: "impressum.html", name: "Impressum" },
    { datei: "datenschutz.html", name: "Datenschutz" },
  ];

  // Rückfall-Liste der Bilder, falls das Einlesen der Seiten fehlschlägt
  const BILDER_STANDARD = new Map([
    ["bild_logo", { alt: "Logo (Kopfzeile, Startseite, Fußzeile)", quelle: "assets/img/logo.png", seiten: ["alle Seiten"] }],
    ["bild_team", { alt: "Teamfoto (Über uns, Startseite)", quelle: "assets/img/team.jpg", seiten: ["Startseite", "Über uns"] }],
    ["bild_spielzimmer", { alt: "Spielzimmer (Galerie, Über uns)", quelle: "assets/img/spielzimmer.jpg", seiten: ["Galerie", "Über uns"] }],
    ["bild_raum", { alt: "Spiel- & Schlafraum (Galerie, Über uns)", quelle: "assets/img/raum.jpg", seiten: ["Galerie", "Über uns"] }],
    ["bild_garten", { alt: "Außengelände (Galerie, Über uns)", quelle: "assets/img/garten.jpg", seiten: ["Galerie", "Über uns"] }],
  ]);

  /* Trusted-Types-Richtlinie ausschließlich für DOMParser: Die eingelesenen
     eigenen Seiten werden nie ins DOM eingefügt, sondern nur ausgewertet.
     Der Name ist in der CSP (trusted-types portal-parser) freigegeben. */
  const parserRichtlinie =
    window.trustedTypes && window.trustedTypes.createPolicy
      ? window.trustedTypes.createPolicy("portal-parser", { createHTML: (eingabe) => eingabe })
      : null;

  function htmlParsen(quelltext) {
    // style-Attribute vorab entfernen: Sie werden für den Scan nicht benötigt
    // und würden sonst beim Parsen CSP-Meldungen auslösen (style-src 'self')
    const bereinigt = quelltext.replace(/\sstyle="[^"]*"/g, "");
    const eingabe = parserRichtlinie ? parserRichtlinie.createHTML(bereinigt) : bereinigt;
    return new DOMParser().parseFromString(eingabe, "text/html");
  }

  let zugang = null;           // geprüfter Inhalt von daten/zugang.json
  let veroeffentlicht = {};    // Inhalt von daten/inhalte.json
  let entwurf = {};            // aktueller Bearbeitungsstand
  let scanErgebnis = null;     // { texte: [...], bilder: Map, quelle: "scan"|"fallback" }
  let versucheImSpeicher = { anzahl: 0, gesperrtBis: 0 };

  document.addEventListener("DOMContentLoaded", start);

  async function start() {
    initPasswortAuge();

    try {
      const [z, i] = await Promise.all([
        fetch("daten/zugang.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("daten/inhalte.json", { cache: "no-store" }).then((r) => r.json()),
      ]);
      zugang = z;
      veroeffentlicht = i && typeof i === "object" ? i : {};
    } catch {
      meldung("anmelde-meldung",
        "Konfiguration konnte nicht geladen werden. Das Portal funktioniert nur über einen Webserver (https bzw. localhost), nicht direkt aus dem Dateisystem.");
      return;
    }

    if (!zugangGueltig(zugang)) {
      meldung("anmelde-meldung",
        "Die Zugangsdatei (daten/zugang.json) ist beschädigt oder hat ein unerwartetes Format – Anmeldung nicht möglich.");
      return;
    }

    if (!window.crypto || !crypto.subtle) {
      meldung("anmelde-meldung",
        "Dieser Browser unterstützt die nötige Verschlüsselung nicht (unsicherer Kontext?). Bitte die Seite über HTTPS aufrufen.");
      return;
    }

    document.getElementById("anmelde-formular").addEventListener("submit", anmelden);
    document.getElementById("abmelden").addEventListener("click", abmelden);
    document.getElementById("speichern").addEventListener("click", vorschauSpeichern);
    document.getElementById("exportieren").addEventListener("click", exportieren);
    document.getElementById("zuruecksetzen").addEventListener("click", zuruecksetzen);
    document.getElementById("passwort-formular").addEventListener("submit", passwortAendern);
    document.getElementById("vorschau-neu").addEventListener("click", vorschauNeuLaden);
    document.getElementById("vorschau-seite").addEventListener("change", vorschauSeiteWechseln);

    // Aktivität verlängert die Sitzung (bis zum absoluten Maximum)
    ["click", "keydown"].forEach((ev) =>
      document.addEventListener(ev, () => { if (sitzungAktiv()) sitzungVerlaengern(); }));
    setInterval(() => {
      if (istAngemeldet() && !sitzungAktiv()) abmelden();
    }, 10000);

    if (sitzungAktiv()) portalZeigen();
  }

  /* Auge im Passwortfeld: zeigt das Passwort kurzzeitig an
     (verbirgt sich nach 5 Sekunden automatisch wieder) */
  function initPasswortAuge() {
    const auge = document.getElementById("passwort-auge");
    const feld = document.getElementById("passwort");
    if (!auge || !feld) return;

    let timer = null;

    function verbergen() {
      clearTimeout(timer);
      feld.type = "password";
      auge.textContent = "👁️";
      auge.setAttribute("aria-pressed", "false");
      auge.title = "Passwort anzeigen";
    }

    auge.addEventListener("click", () => {
      if (feld.type === "password") {
        feld.type = "text";
        auge.textContent = "🙈";
        auge.setAttribute("aria-pressed", "true");
        auge.title = "Passwort verbergen";
        clearTimeout(timer);
        timer = setTimeout(verbergen, 5000);
      } else {
        verbergen();
      }
      feld.focus();
    });

    // beim Absenden sicherheitshalber wieder verbergen
    document.getElementById("anmelde-formular").addEventListener("submit", verbergen);
  }

  /* ------------------------- Anmeldung / Sitzung ------------------------- */

  function zugangGueltig(z) {
    return !!z && typeof z === "object"
      && typeof z.salz === "string" && /^[0-9a-f]{16,128}$/i.test(z.salz) && z.salz.length % 2 === 0
      && typeof z.hash === "string" && /^[0-9a-f]{64}$/i.test(z.hash)
      && Number.isInteger(z.iterationen)
      && z.iterationen >= 100000 && z.iterationen <= 5000000;
  }

  function hexZuBytes(hex) {
    return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  }

  function bytesZuHex(bytes) {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function pbkdf2(passwort, salzHex, iterationen) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: hexZuBytes(salzHex), iterations: iterationen },
      material, 256);
    return bytesZuHex(new Uint8Array(bits));
  }

  // Vergleich in konstanter Zeit – das Ergebnis hängt nicht davon ab,
  // an welcher Stelle sich die Werte unterscheiden
  function gleicheHashes(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let unterschied = 0;
    for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return unterschied === 0;
  }

  /* Fehlversuche werden in localStorage UND im Arbeitsspeicher geführt –
     das Löschen des Browser-Speichers hebt eine laufende Sperre innerhalb
     der geöffneten Seite dadurch nicht auf. */
  function versuche() {
    let gespeichert = { anzahl: 0, gesperrtBis: 0 };
    try {
      const roh = JSON.parse(localStorage.getItem(VERSUCHE_SCHLUESSEL));
      if (roh && typeof roh === "object") {
        gespeichert.anzahl = Number(roh.anzahl) || 0;
        gespeichert.gesperrtBis = Number(roh.gesperrtBis) || 0;
      }
    } catch { /* beschädigte Daten zählen wie leer */ }
    return {
      anzahl: Math.max(gespeichert.anzahl, versucheImSpeicher.anzahl),
      gesperrtBis: Math.max(gespeichert.gesperrtBis, versucheImSpeicher.gesperrtBis),
    };
  }

  function versucheSpeichern(v) {
    versucheImSpeicher = { anzahl: v.anzahl, gesperrtBis: v.gesperrtBis };
    try {
      localStorage.setItem(VERSUCHE_SCHLUESSEL, JSON.stringify(v));
    } catch { /* voller Speicher ändert nichts an der Sperre im Arbeitsspeicher */ }
  }

  async function anmelden(e) {
    e.preventDefault();
    const jetzt = Date.now();
    const v = versuche();
    const feld = document.getElementById("passwort");

    if (v.gesperrtBis > jetzt) {
      const sek = Math.ceil((v.gesperrtBis - jetzt) / 1000);
      feld.value = "";
      meldung("anmelde-meldung", `Zu viele Fehlversuche – bitte ${sek} Sekunden warten.`);
      return;
    }

    const knopf = document.querySelector('#anmelde-formular button[type="submit"]');
    knopf.disabled = true;
    knopf.textContent = "Prüfe …";

    const eingabe = feld.value;
    feld.value = "";
    const hash = await pbkdf2(eingabe, zugang.salz, zugang.iterationen);

    knopf.disabled = false;
    knopf.textContent = "Anmelden";

    if (gleicheHashes(hash, zugang.hash)) {
      versucheSpeichern({ anzahl: 0, gesperrtBis: 0 });
      sitzungStarten();
      portalZeigen();
    } else {
      v.anzahl += 1;
      if (v.anzahl >= MAX_VERSUCHE) {
        // exponentiell steigende Sperre: 1, 2, 4, 8 … Minuten
        const minuten = Math.min(Math.pow(2, v.anzahl - MAX_VERSUCHE), 60);
        v.gesperrtBis = jetzt + minuten * 60000;
        meldung("anmelde-meldung",
          `Falsches Passwort. Anmeldung für ${minuten} Minute(n) gesperrt.`);
      } else {
        meldung("anmelde-meldung",
          `Falsches Passwort (${v.anzahl}/${MAX_VERSUCHE} Versuche).`);
      }
      versucheSpeichern(v);
    }
  }

  function sitzungLesen() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SITZUNG_SCHLUESSEL));
      if (s && typeof s === "object" &&
          Number.isFinite(Number(s.bis)) && Number.isFinite(Number(s.ende))) {
        return { bis: Number(s.bis), ende: Number(s.ende) };
      }
    } catch { /* beschädigte Sitzung gilt als abgelaufen */ }
    return null;
  }

  function sitzungStarten() {
    const jetzt = Date.now();
    sessionStorage.setItem(SITZUNG_SCHLUESSEL, JSON.stringify({
      bis: jetzt + SITZUNG_MINUTEN * 60000,
      ende: jetzt + SITZUNG_MAX_STUNDEN * 3600000,
    }));
  }

  function sitzungVerlaengern() {
    const s = sitzungLesen();
    if (!s) return;
    s.bis = Math.min(Date.now() + SITZUNG_MINUTEN * 60000, s.ende);
    sessionStorage.setItem(SITZUNG_SCHLUESSEL, JSON.stringify(s));
  }

  function istAngemeldet() {
    return document.getElementById("portal").style.display === "block";
  }

  function sitzungAktiv() {
    const s = sitzungLesen();
    return !!s && s.bis > Date.now() && s.ende > Date.now();
  }

  function abmelden() {
    sessionStorage.removeItem(SITZUNG_SCHLUESSEL);
    document.getElementById("portal").style.display = "none";
    document.getElementById("anmeldung").style.display = "block";
    const rahmen = document.getElementById("vorschau-rahmen");
    if (rahmen && rahmen.src) rahmen.src = "about:blank";
  }

  /* --------------------- Website einlesen (dynamisch) --------------------- */

  /* Liest alle Seiten der Website ein und erkennt bearbeitbare Stellen –
     das Portal bleibt dadurch automatisch im Gleichklang mit der Website. */
  async function websiteScannen() {
    const texte = [];
    const bilder = new Map();
    const gesehen = new Set(FELDER);

    for (const seite of SEITEN) {
      const antwort = await fetch(seite.datei, { cache: "no-store" });
      if (!antwort.ok) throw new Error("Seite nicht ladbar: " + seite.datei);
      const doc = htmlParsen(await antwort.text());

      doc.querySelectorAll("[data-cms], [data-cms-html]").forEach((el) => {
        const schluessel = el.dataset.cms || el.dataset.cmsHtml;
        if (!schluessel || gesehen.has(schluessel)) return;
        gesehen.add(schluessel);
        texte.push({
          schluessel,
          seite: seite.name,
          art: el.dataset.cmsHtml ? "html" : "text",
          label: feldLabel(el),
        });
      });

      doc.querySelectorAll("[data-cms-bild]").forEach((el) => {
        const schluessel = el.dataset.cmsBild;
        if (!schluessel) return;
        if (!bilder.has(schluessel)) {
          bilder.set(schluessel, {
            alt: (el.getAttribute("alt") || schluessel).replace(/\s+/g, " ").trim(),
            quelle: el.getAttribute("src") || "",
            seiten: [],
          });
        }
        const eintrag = bilder.get(schluessel);
        if (!eintrag.seiten.includes(seite.name)) eintrag.seiten.push(seite.name);
      });
    }

    if (!texte.length) throw new Error("keine Felder gefunden");
    return { texte, bilder, quelle: "scan" };
  }

  function feldLabel(el) {
    const arten = {
      H1: "Überschrift", H2: "Überschrift", H3: "Überschrift", H4: "Überschrift",
      A: "Button/Link", BUTTON: "Button/Link", TH: "Tabellenkopf", TD: "Tabelle",
      LI: "Liste",
    };
    const art = arten[el.tagName] || "Text";
    const inhalt = el.textContent.replace(/\s+/g, " ").trim();
    const kurz = inhalt.length > 60 ? inhalt.slice(0, 59).trimEnd() + "…" : inhalt;
    return `${art}: ${kurz}`;
  }

  /* Rückfall, falls das Einlesen fehlschlägt: gespeicherte Feldliste nutzen */
  async function schemaLaden() {
    try {
      return await websiteScannen();
    } catch {
      try {
        const antwort = await fetch("daten/portal-schema.json", { cache: "no-store" });
        const liste = await antwort.json();
        if (!Array.isArray(liste)) throw new Error("Schema unlesbar");
        return { texte: liste, bilder: new Map(BILDER_STANDARD), quelle: "fallback" };
      } catch {
        return { texte: [], bilder: new Map(BILDER_STANDARD), quelle: "fallback" };
      }
    }
  }

  /* ----------------------------- Portal-Ansicht ----------------------------- */

  function lokaleDaten() {
    try {
      return JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL)) || {};
    } catch {
      return {};
    }
  }

  async function portalZeigen() {
    document.getElementById("anmeldung").style.display = "none";
    document.getElementById("portal").style.display = "block";

    entwurf = Object.assign({}, veroeffentlicht, lokaleDaten());

    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) feld.value = entwurf[schluessel] || "";
    });

    if (!scanErgebnis) {
      scanInfo("🔎 Website wird eingelesen …");
      scanErgebnis = await schemaLaden();
    }

    bilderAufbauen(scanErgebnis.bilder);
    dynamischeBereicheAufbauen(scanErgebnis.texte);

    if (scanErgebnis.quelle === "scan") {
      scanInfo(`🔎 Automatisch erkannt: ${scanErgebnis.texte.length} Textfelder und ` +
        `${scanErgebnis.bilder.size} Bilder auf ${SEITEN.length} Seiten.`);
    } else {
      scanInfo("⚠️ Die Seiten konnten nicht eingelesen werden – es gilt die " +
        "gespeicherte Feldliste (daten/portal-schema.json).");
    }

    vorschauStarten();
    statusAktualisieren();
  }

  function scanInfo(text) {
    const el = document.getElementById("scan-info");
    el.textContent = text;
  }

  /* Baut die Bilder-Liste aus den im Scan gefundenen Bildern auf */
  function bilderAufbauen(bilder) {
    const halter = document.getElementById("bilder-liste");
    halter.replaceChildren();

    bilder.forEach((info, schluessel) => {
      const zeile = document.createElement("div");
      zeile.className = "bild-zeile";

      const bild = document.createElement("img");
      bild.id = "vorschau-" + schluessel;
      bild.alt = info.alt;
      bild.width = 110;
      bild.height = 80;
      if (schluessel === "bild_logo") bild.classList.add("bild-logo-vorschau");
      const wert = entwurf[schluessel];
      bild.src = (typeof wert === "string" && wert) ? wert : info.quelle;

      const feld = document.createElement("div");
      feld.className = "feld";

      const label = document.createElement("label");
      label.setAttribute("for", "upload-" + schluessel);
      label.textContent = info.alt;

      const eingabe = document.createElement("input");
      eingabe.type = "file";
      eingabe.id = "upload-" + schluessel;
      eingabe.accept = "image/*";
      eingabe.addEventListener("change", (e) => bildLaden(e, schluessel));

      const seiten = document.createElement("small");
      seiten.className = "bild-seiten";
      seiten.textContent = "Zu sehen auf: " + info.seiten.join(", ");

      feld.append(label, eingabe, seiten);
      zeile.append(bild, feld);
      halter.appendChild(zeile);
    });
  }

  /* Baut für jede Seite einen aufklappbaren Bereich mit allen Textfeldern */
  function dynamischeBereicheAufbauen(texte) {
    const halter = document.getElementById("dynamische-bereiche");
    halter.replaceChildren();

    const gruppen = new Map();
    texte.forEach((eintrag) => {
      if (!gruppen.has(eintrag.seite)) gruppen.set(eintrag.seite, []);
      gruppen.get(eintrag.seite).push(eintrag);
    });

    gruppen.forEach((eintraege, seite) => {
      const details = document.createElement("details");
      details.className = "portal-karte portal-details";

      const summary = document.createElement("summary");
      summary.textContent = `📄 ${seite} (${eintraege.length} Felder)`;
      details.appendChild(summary);

      eintraege.forEach((eintrag) => {
        const feld = document.createElement("div");
        feld.className = "feld";

        const label = document.createElement("label");
        label.setAttribute("for", "dyn-" + eintrag.schluessel);
        label.textContent = eintrag.label;
        feld.appendChild(label);

        const wert = entwurf[eintrag.schluessel] || "";
        const lang = eintrag.art === "html" || wert.length > 70 || wert.includes("\n");
        const eingabe = document.createElement(lang ? "textarea" : "input");
        eingabe.id = "dyn-" + eintrag.schluessel;
        eingabe.dataset.schluessel = eintrag.schluessel;
        eingabe.value = wert;
        if (lang) eingabe.rows = Math.min(6, Math.max(2, Math.ceil(wert.length / 80)));

        if (eintrag.art === "html") {
          eingabe.classList.add("html-feld");
          const hinweis = document.createElement("small");
          hinweis.className = "html-hinweis";
          hinweis.textContent =
            "Enthält Formatierung: Teile in spitzen Klammern (z. B. <strong>) bitte stehen lassen.";
          feld.appendChild(eingabe);
          feld.appendChild(hinweis);
        } else {
          feld.appendChild(eingabe);
        }
        details.appendChild(feld);
      });

      halter.appendChild(details);
    });
  }

  /* ----------------------------- Live-Vorschau ----------------------------- */

  function vorschauStarten() {
    const auswahl = document.getElementById("vorschau-seite");
    const rahmen = document.getElementById("vorschau-rahmen");

    if (!auswahl.options.length) {
      SEITEN.forEach((seite) => {
        const option = document.createElement("option");
        option.value = seite.datei;
        option.textContent = seite.name;
        auswahl.appendChild(option);
      });
    }

    const gewaehlt = SEITEN.find((s) => s.datei === auswahl.value) || SEITEN[0];
    rahmen.src = gewaehlt.datei;
  }

  function vorschauSeiteWechseln() {
    const auswahl = document.getElementById("vorschau-seite");
    // nur Dateinamen aus der festen Seitenliste zulassen
    const seite = SEITEN.find((s) => s.datei === auswahl.value);
    if (seite) document.getElementById("vorschau-rahmen").src = seite.datei;
  }

  function vorschauNeuLaden() {
    const rahmen = document.getElementById("vorschau-rahmen");
    if (!rahmen.src || rahmen.src === "about:blank") return;
    try {
      rahmen.contentWindow.location.reload();
    } catch {
      const quelle = rahmen.src;
      rahmen.src = quelle;
    }
  }

  /* ----------------------------- Aktionen ----------------------------- */

  function formularAuslesen() {
    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) entwurf[schluessel] = feld.value.trim();
    });
    document.querySelectorAll("[data-schluessel]").forEach((feld) => {
      entwurf[feld.dataset.schluessel] = feld.value.trim();
    });
  }

  function statusAktualisieren() {
    const lokal = lokaleDaten();
    const abweichungen = Object.keys(lokal).filter((k) => lokal[k] !== veroeffentlicht[k]);
    const status = document.getElementById("status");
    if (abweichungen.length) {
      status.textContent = `⚠️ ${abweichungen.length} Änderung(en) nur lokal gespeichert – ` +
        "zum Veröffentlichen die Datei exportieren und hochladen.";
      status.className = "portal-status offen";
    } else {
      status.textContent = "✅ Alles veröffentlicht – keine offenen Änderungen.";
      status.className = "portal-status fertig";
    }
  }

  function vorschauSpeichern() {
    formularAuslesen();
    try {
      localStorage.setItem(LOKAL_SCHLUESSEL, JSON.stringify(entwurf));
      meldung("portal-meldung",
        "Gespeichert! Die Änderungen sind sofort in DIESEM Browser sichtbar – auch in der Live-Vorschau. Für alle Besucher: „Veröffentlichen“ nutzen.", true);
      statusAktualisieren();
      vorschauNeuLaden();
    } catch {
      meldung("portal-meldung",
        "Speichern fehlgeschlagen – vermutlich sind die Bilder zu groß für den lokalen Speicher.");
    }
  }

  function exportieren() {
    formularAuslesen();
    const blob = new Blob([JSON.stringify(entwurf, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inhalte.json";
    a.click();
    URL.revokeObjectURL(a.href);
    meldung("portal-meldung",
      "Datei „inhalte.json“ heruntergeladen. Diese Datei in den Ordner daten/ der Website hochladen (ersetzen) – dann sehen alle Besucher die Änderungen.", true);
  }

  function zuruecksetzen() {
    if (!confirm("Alle lokalen (unveröffentlichten) Änderungen verwerfen?")) return;
    localStorage.removeItem(LOKAL_SCHLUESSEL);
    portalZeigen();
    meldung("portal-meldung", "Lokale Änderungen verworfen – es gilt wieder der veröffentlichte Stand.", true);
  }

  /* ----------------------------- Bilder ----------------------------- */

  function bildLaden(e, schluessel) {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    if (!/^image\//.test(datei.type)) {
      meldung("portal-meldung", "Bitte eine Bilddatei auswählen (JPG oder PNG).");
      return;
    }

    const leser = new FileReader();
    leser.onload = () => {
      const bild = new Image();
      bild.onload = () => {
        // verkleinern, damit der lokale Speicher und die Website schlank bleiben
        const maxBreite = 1200;
        const faktor = Math.min(1, maxBreite / bild.width);
        const leinwand = document.createElement("canvas");
        leinwand.width = Math.round(bild.width * faktor);
        leinwand.height = Math.round(bild.height * faktor);
        leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        // PNG behält Transparenz (wichtig fürs Logo), sonst platzsparendes JPEG
        const datenUri = datei.type === "image/png"
          ? leinwand.toDataURL("image/png")
          : leinwand.toDataURL("image/jpeg", 0.85);

        entwurf[schluessel] = datenUri;
        const vorschau = document.getElementById("vorschau-" + schluessel);
        if (vorschau) vorschau.src = datenUri;
        meldung("portal-meldung",
          "Bild übernommen – mit „Vorschau speichern“ testen und mit „Veröffentlichen“ exportieren.", true);
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  }

  /* ----------------------------- Passwort ändern ----------------------------- */

  /* Prüft neue Passwörter auf typische Schwächen; gibt null zurück, wenn alles
     in Ordnung ist. Beim rein statischen Hosting ist die Passwortstärke der
     entscheidende Schutz – der Hash ist öffentlich abrufbar. */
  function passwortSchwaeche(pw) {
    if (pw.length < 12) {
      return "Das neue Passwort muss mindestens 12 Zeichen lang sein.";
    }
    const klein = pw.toLowerCase();
    const verboten = ["passwort", "password", "qwertz", "qwerty", "123456", "abcdef",
      "krabbelzwerg", "melli", "willkommen", "geheim"];
    const treffer = verboten.find((w) => klein.includes(w));
    if (treffer) {
      return `Bitte kein leicht zu erratendes Passwort – „${treffer}“ steht auf jeder Rate-Liste.`;
    }
    if (/^(.)\1+$/.test(pw)) {
      return "Bitte nicht immer dasselbe Zeichen wiederholen.";
    }
    const klassen = [/[a-zäöüß]/.test(pw), /[A-ZÄÖÜ]/.test(pw), /[0-9]/.test(pw),
      /[^0-9a-zA-ZäöüßÄÖÜ]/.test(pw)].filter(Boolean).length;
    if (pw.length < 16 && klassen < 2) {
      return "Bitte mindestens 16 Zeichen (z. B. eine Passphrase aus mehreren Wörtern) – oder Groß-/Kleinschreibung, Zahlen bzw. Sonderzeichen mischen.";
    }
    return null;
  }

  async function passwortAendern(e) {
    e.preventDefault();
    const neu = document.getElementById("passwort-neu").value;
    const wiederholung = document.getElementById("passwort-wdh").value;

    const problem = passwortSchwaeche(neu);
    if (problem) {
      meldung("passwort-meldung", problem);
      return;
    }
    if (neu !== wiederholung) {
      meldung("passwort-meldung", "Die beiden Eingaben stimmen nicht überein.");
      return;
    }

    const salzBytes = crypto.getRandomValues(new Uint8Array(16));
    const salz = bytesZuHex(salzBytes);
    const hash = await pbkdf2(neu, salz, NEUE_ITERATIONEN);

    const inhalt = {
      hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
      algorithmus: "PBKDF2-SHA256",
      iterationen: NEUE_ITERATIONEN,
      salz,
      hash,
    };
    const blob = new Blob([JSON.stringify(inhalt, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "zugang.json";
    a.click();
    URL.revokeObjectURL(a.href);

    document.getElementById("passwort-neu").value = "";
    document.getElementById("passwort-wdh").value = "";
    meldung("passwort-meldung",
      "Datei „zugang.json“ heruntergeladen. Diese Datei in den Ordner daten/ hochladen (ersetzen) – danach gilt das neue Passwort. Das alte bleibt bis dahin aktiv.", true);
  }

  /* ----------------------------- Hilfen ----------------------------- */

  function meldung(ziel, text, gut) {
    const el = document.getElementById(ziel);
    el.textContent = text;
    el.className = "portal-hinweis " + (gut ? "gut" : "schlecht");
    el.style.display = "block";
  }
})();
