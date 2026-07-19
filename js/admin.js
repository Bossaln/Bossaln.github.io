/* ==========================================================================
   Melli's Krabbelzwerge – Verwaltungs-Portal
   Anmeldung: PBKDF2-SHA256-Hash-Vergleich (WebCrypto), Sperre nach
   Fehlversuchen, Sitzungs-Timeout. Bearbeitung: Inhalte werden lokal
   gespeichert (Sofort-Vorschau) und zum Veröffentlichen als Datei
   exportiert.
   ========================================================================== */

(function () {
  "use strict";

  const LOKAL_SCHLUESSEL = "mellis_cms_inhalte";
  const SITZUNG_SCHLUESSEL = "mellis_admin_sitzung";
  const VERSUCHE_SCHLUESSEL = "mellis_admin_versuche";
  const SITZUNG_MINUTEN = 30;
  const MAX_VERSUCHE = 5;

  const FELDER = ["slogan", "zeit_mo_do", "zeit_fr", "zeit_sa_so", "telefon", "email"];
  const BILDER = ["bild_team", "bild_spielzimmer", "bild_raum", "bild_garten"];

  let zugang = null;          // Inhalt von daten/zugang.json
  let veroeffentlicht = {};   // Inhalt von daten/inhalte.json
  let entwurf = {};           // aktueller Bearbeitungsstand

  document.addEventListener("DOMContentLoaded", start);

  async function start() {
    try {
      const [z, i] = await Promise.all([
        fetch("daten/zugang.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("daten/inhalte.json", { cache: "no-store" }).then((r) => r.json()),
      ]);
      zugang = z;
      veroeffentlicht = i;
    } catch {
      meldung("anmelde-meldung",
        "Konfiguration konnte nicht geladen werden. Das Portal funktioniert nur über einen Webserver (https bzw. localhost), nicht direkt aus dem Dateisystem.");
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

    BILDER.forEach((schluessel) => {
      const eingabe = document.getElementById("upload-" + schluessel);
      if (eingabe) eingabe.addEventListener("change", (e) => bildLaden(e, schluessel));
    });

    // Aktivität verlängert die Sitzung
    ["click", "keydown"].forEach((ev) =>
      document.addEventListener(ev, () => { if (sitzungAktiv()) sitzungStarten(); }));
    setInterval(() => {
      if (istAngemeldet() && !sitzungAktiv()) abmelden();
    }, 10000);

    if (sitzungAktiv()) portalZeigen();
  }

  /* ------------------------- Anmeldung / Sitzung ------------------------- */

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

  function versuche() {
    try {
      return JSON.parse(localStorage.getItem(VERSUCHE_SCHLUESSEL)) || { anzahl: 0, gesperrtBis: 0 };
    } catch {
      return { anzahl: 0, gesperrtBis: 0 };
    }
  }

  function versucheSpeichern(v) {
    localStorage.setItem(VERSUCHE_SCHLUESSEL, JSON.stringify(v));
  }

  async function anmelden(e) {
    e.preventDefault();
    const jetzt = Date.now();
    const v = versuche();

    if (v.gesperrtBis > jetzt) {
      const sek = Math.ceil((v.gesperrtBis - jetzt) / 1000);
      meldung("anmelde-meldung", `Zu viele Fehlversuche – bitte ${sek} Sekunden warten.`);
      return;
    }

    const knopf = document.querySelector("#anmelde-formular button");
    knopf.disabled = true;
    knopf.textContent = "Prüfe …";

    const eingabe = document.getElementById("passwort").value;
    const hash = await pbkdf2(eingabe, zugang.salz, zugang.iterationen);

    knopf.disabled = false;
    knopf.textContent = "Anmelden";

    if (hash === zugang.hash) {
      versucheSpeichern({ anzahl: 0, gesperrtBis: 0 });
      document.getElementById("passwort").value = "";
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

  function sitzungStarten() {
    sessionStorage.setItem(SITZUNG_SCHLUESSEL,
      JSON.stringify({ bis: Date.now() + SITZUNG_MINUTEN * 60000 }));
  }

  function istAngemeldet() {
    return document.getElementById("portal").style.display === "block";
  }

  function sitzungAktiv() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SITZUNG_SCHLUESSEL));
      return s && s.bis > Date.now();
    } catch {
      return false;
    }
  }

  function abmelden() {
    sessionStorage.removeItem(SITZUNG_SCHLUESSEL);
    document.getElementById("portal").style.display = "none";
    document.getElementById("anmeldung").style.display = "block";
  }

  /* ----------------------------- Portal-Ansicht ----------------------------- */

  function lokaleDaten() {
    try {
      return JSON.parse(localStorage.getItem(LOKAL_SCHLUESSEL)) || {};
    } catch {
      return {};
    }
  }

  function portalZeigen() {
    document.getElementById("anmeldung").style.display = "none";
    document.getElementById("portal").style.display = "block";

    entwurf = Object.assign({}, veroeffentlicht, lokaleDaten());

    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) feld.value = entwurf[schluessel] || "";
    });
    BILDER.forEach((schluessel) => {
      const vorschau = document.getElementById("vorschau-" + schluessel);
      if (vorschau && entwurf[schluessel]) vorschau.src = entwurf[schluessel];
    });
    statusAktualisieren();
  }

  function formularAuslesen() {
    FELDER.forEach((schluessel) => {
      const feld = document.getElementById("feld-" + schluessel);
      if (feld) entwurf[schluessel] = feld.value.trim();
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

  /* ----------------------------- Aktionen ----------------------------- */

  function vorschauSpeichern() {
    formularAuslesen();
    try {
      localStorage.setItem(LOKAL_SCHLUESSEL, JSON.stringify(entwurf));
      meldung("portal-meldung",
        "Gespeichert! Die Änderungen sind sofort in DIESEM Browser sichtbar (einfach die Website öffnen). Für alle Besucher: „Veröffentlichen“ nutzen.", true);
      statusAktualisieren();
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
        const datenUri = leinwand.toDataURL("image/jpeg", 0.85);

        entwurf[schluessel] = datenUri;
        document.getElementById("vorschau-" + schluessel).src = datenUri;
        meldung("portal-meldung",
          "Bild übernommen – mit „Vorschau speichern“ testen und mit „Veröffentlichen“ exportieren.", true);
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  }

  /* ----------------------------- Passwort ändern ----------------------------- */

  async function passwortAendern(e) {
    e.preventDefault();
    const neu = document.getElementById("passwort-neu").value;
    const wiederholung = document.getElementById("passwort-wdh").value;

    if (neu.length < 12) {
      meldung("passwort-meldung", "Das neue Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (neu !== wiederholung) {
      meldung("passwort-meldung", "Die beiden Eingaben stimmen nicht überein.");
      return;
    }

    const salzBytes = crypto.getRandomValues(new Uint8Array(16));
    const salz = bytesZuHex(salzBytes);
    const iterationen = 310000;
    const hash = await pbkdf2(neu, salz, iterationen);

    const inhalt = {
      hinweis: "Enthaelt nur den PBKDF2-Hash des Portal-Passworts, niemals das Passwort selbst.",
      algorithmus: "PBKDF2-SHA256",
      iterationen, salz, hash,
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
