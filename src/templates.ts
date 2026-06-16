import { EmailContent, OutreachRow } from "./types";

// Verticals mirror the website's demo deep-link slugs so a click lands on the
// matching workflow and preselects the right business type on the contact form.
// See lib/demo-vertical.ts in the turbo-replies site repo.
type Vertical = "clinic" | "realEstate" | "hotel";

const DEMO_SLUG: Record<Vertical, string> = {
  clinic: "clinic",
  realEstate: "real-estate",
  hotel: "hotel"
};

// Base may include a locale segment; it is replaced per-recipient via Language.
// Locales mirror the website's supported set (lib/i18n/config.ts).
const DEFAULT_DEMO_BASE = "https://www.turboreplies.com/en";
const DEMO_LOCALES = ["en", "it", "fr", "de", "es"] as const;
type DemoLocale = (typeof DEMO_LOCALES)[number];

function ownerFirstNames(owner: string): string[] {
  const normalized = owner
    .replace(/\s*&\s*/g, " e ")
    .replace(/\s+and\s+/gi, " e ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const parts = normalized.split(" e ").map((segment) => segment.trim()).filter(Boolean);
  return parts.map((segment) => segment.split(" ")[0]).filter(Boolean);
}

function firstNamesOnly(owner: string): string {
  return ownerFirstNames(owner).join(" e ");
}

function propertyLabel(row: OutreachRow): string {
  const property = String(row.cells.Property || "").trim();
  const village = String(row.cells.Village || "").trim();
  const location = String(row.cells.Location || "").trim();

  if (property && village) {
    return `${property} in ${village}`;
  }

  if (property && location) {
    return `${property} in ${location}`;
  }

  return property || village || location || "your property";
}

function optionalHook(row: OutreachRow): string {
  const hook = String(row.cells.Hook || "").trim();
  return hook ? `\n\n${hook}` : "";
}

function normalizedLanguage(row: OutreachRow): string {
  return String(row.cells.Language || "").trim().toLowerCase();
}

function isItalian(row: OutreachRow): boolean {
  const language = normalizedLanguage(row);
  return language === "it" || language === "ita" || language === "italian" || language === "italiano";
}

// Maps the Language column to a website locale for the demo link. Email body
// copy is only IT/EN; fr/de/es recipients get the English body but a localized
// demo page, which the site does support.
function demoLocale(row: OutreachRow): DemoLocale {
  const language = normalizedLanguage(row);

  if (/^(it|ita|italian|italiano)/.test(language)) return "it";
  if (/^(fr|fra|fre|french|fran[cç]ais)/.test(language)) return "fr";
  if (/^(de|deu|ger|german|deutsch|tedesco|allemand)/.test(language)) return "de";
  if (/^(es|spa|spanish|espa[nñ]ol|castellano|spagnolo)/.test(language)) return "es";
  return "en";
}

function contactGreeting(row: OutreachRow): string {
  const firstNames = firstNamesOnly(String(row.cells.Owner || "").trim());
  return firstNames ? `Buongiorno ${firstNames}` : "Buongiorno";
}

function hasMultipleRecipients(row: OutreachRow): boolean {
  return ownerFirstNames(String(row.cells.Owner || "").trim()).length > 1;
}

function italianValuePronoun(multipleRecipients: boolean): string {
  return multipleRecipients ? "per voi" : "per Lei";
}

// Hotel is the default so blank/unknown Vertical keeps the original hospitality copy.
function detectVertical(row: OutreachRow): Vertical {
  const raw = String(row.cells.Vertical || "").trim().toLowerCase();

  if (/(clinic|dent|odonto|medic|dottor|poliambulator|studio medico|salute|health)/.test(raw)) {
    return "clinic";
  }

  if (/(real[\s-]?estate|immobil|agenzia|realtor|property|case)/.test(raw)) {
    return "realEstate";
  }

  return "hotel";
}

// Rewrites a leading /en or /it locale segment to the recipient's locale, or
// prepends one if the base path has none.
function withLocale(pathAndQuery: string, locale: string): string {
  const localePattern = new RegExp(`^/(?:${DEMO_LOCALES.join("|")})(?=/|\\?|$)`);
  if (localePattern.test(pathAndQuery)) {
    return pathAndQuery.replace(localePattern, `/${locale}`);
  }
  return `/${locale}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
}

function demoUrl(vertical: Vertical, locale: DemoLocale, followUpStep: number): string {
  const base = (process.env.OUTREACH_DEMO_URL || DEFAULT_DEMO_BASE).trim();
  const [rawPathAndQuery, existingHash] = base.split("#");
  const originMatch = rawPathAndQuery.match(/^https?:\/\/[^/]+/i);
  const origin = originMatch ? originMatch[0] : "";
  const pathAndQuery = withLocale(rawPathAndQuery.slice(origin.length) || "/", locale);
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const slug = DEMO_SLUG[vertical];
  const query = [
    `vertical=${slug}`,
    "utm_source=outreach",
    "utm_medium=email",
    `utm_campaign=${slug}`,
    `utm_content=step${followUpStep}`
  ].join("&");
  const hash = existingHash || "interactive-demos";
  return `${origin}${pathAndQuery}${separator}${query}#${hash}`;
}

// What the assistant captures, used in the lead-with-value paragraph.
function valueParagraph(vertical: Vertical, italian: boolean, multipleRecipients: boolean): string {
  const you = multipleRecipients ? "voi" : "Lei";

  if (italian) {
    if (vertical === "clinic") {
      return `Aiutiamo studi medici e dentistici a non perdere pazienti: un assistente AI risponde subito alle richieste di appuntamento dal sito, da WhatsApp, Instagram e Facebook — anche fuori orario — chiede il motivo della visita e i recapiti, e passa tutto alla reception già in ordine. Non sostituisce il personale: nessun appuntamento viene confermato senza di ${you}.`;
    }
    if (vertical === "realEstate") {
      return `Aiutiamo le agenzie immobiliari a non perdere contatti: un assistente AI risponde all'istante alle richieste sugli annunci — chi risponde per primo prende il cliente — raccoglie immobile di interesse, budget e tempistiche, e passa il lead già qualificato all'agente. Non sostituisce il vostro lavoro: nulla viene deciso senza di ${you}.`;
    }
    return `Aiutiamo le strutture ricettive a non perdere richieste: un assistente AI risponde subito agli ospiti — giorno e notte e anche in inglese, tedesco e francese — raccoglie date e numero di persone, e ${multipleRecipients ? "vi passa" : "Le passa"} la richiesta già pronta. Non sostituisce il vostro lavoro: nulla viene confermato senza di ${you}.`;
  }

  if (vertical === "clinic") {
    return `We help medical and dental practices stop losing patients: an AI assistant instantly answers appointment requests from your website, WhatsApp, Instagram and Facebook — even after hours — asks the reason for the visit and contact details, and hands everything to your front desk ready to act on. It never replaces your staff; nothing is booked without you.`;
  }
  if (vertical === "realEstate") {
    return `We help agencies stop losing leads: an AI assistant replies instantly to listing enquiries — the first to respond wins the client — captures the property of interest, budget and timing, and hands the qualified lead to your agent. It never replaces your work; nothing is decided without you.`;
  }
  return `We help hospitality teams never miss an enquiry: an AI assistant replies to guests instantly — day and night, in English, German and French — collects dates and party size, and hands the qualified request to your team. It never replaces your staff; nothing is confirmed without you.`;
}

// One-line benefit reused in follow-ups.
function shortBenefit(vertical: Vertical, italian: boolean, multipleRecipients: boolean): string {
  if (italian) {
    if (vertical === "clinic") {
      return "risponde subito alle richieste di appuntamento, anche fuori orario, e le passa alla reception già qualificate";
    }
    if (vertical === "realEstate") {
      return "risponde all'istante ai contatti sugli annunci e li passa all'agente già qualificati";
    }
    return `risponde subito agli ospiti, anche in più lingue, e ${multipleRecipients ? "vi passa" : "Le passa"} le richieste già pronte`;
  }

  if (vertical === "clinic") {
    return "answers appointment requests instantly, even after hours, and hands them to your front desk already qualified";
  }
  if (vertical === "realEstate") {
    return "answers listing enquiries instantly and hands them to your agent already qualified";
  }
  return "answers guests instantly, in multiple languages, and hands you ready-to-action requests";
}

function audienceNoun(vertical: Vertical, italian: boolean): string {
  if (italian) {
    if (vertical === "clinic") return "pazienti";
    if (vertical === "realEstate") return "clienti";
    return "ospiti";
  }
  if (vertical === "clinic") return "patients";
  if (vertical === "realEstate") return "clients";
  return "guests";
}

function firstSubject(vertical: Vertical, italian: boolean, property: string): string {
  if (italian) {
    if (vertical === "clinic") return `Meno richieste di appuntamento perse per ${property}`;
    if (vertical === "realEstate") return `Rispondere per primi ai contatti di ${property}`;
    return `Nessuna richiesta persa per ${property}`;
  }
  if (vertical === "clinic") return `Stop missing appointment requests at ${property}`;
  if (vertical === "realEstate") return `Be first to reply to leads at ${property}`;
  return `Never miss an enquiry at ${property}`;
}

function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function demoLineText(italian: boolean, url: string): string {
  return italian
    ? `Può vederlo in una demo interattiva di un minuto, già impostata sul vostro settore:\n${url}`
    : `You can see it in a one-minute interactive demo, pre-set for your sector:\n${url}`;
}

function demoLineHtml(italian: boolean, url: string): string {
  const label = italian
    ? "Può vederlo in una demo interattiva di un minuto, già impostata sul vostro settore:"
    : "You can see it in a one-minute interactive demo, pre-set for your sector:";
  return `${label}<br /><a href="${url}">${url}</a>`;
}

export function buildEmail(row: OutreachRow, followUpStep: number): EmailContent {
  const italian = isItalian(row);
  const greeting = contactGreeting(row);
  const multipleRecipients = hasMultipleRecipients(row);
  const property = propertyLabel(row);
  const vertical = detectVertical(row);
  const hook = String(row.cells.Hook || "").trim();
  const url = demoUrl(vertical, demoLocale(row), followUpStep);

  if (followUpStep === 0) {
    if (italian) {
      const offer = `Se preferisce, mi invii una domanda che ricevete spesso dai vostri ${audienceNoun(vertical, true)} e Le mostro come risponderebbe l'assistente, su misura per ${property}.`;
      const paragraphs = [
        `${greeting},`,
        `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} da TurboReplies. ${valueParagraph(vertical, true, multipleRecipients)}`,
        `Guardando ${property}, ho pensato che potesse essere rilevante ${italianValuePronoun(multipleRecipients)}.${hook ? `\n\n${hook}` : ""}`,
        demoLineText(true, url),
        offer,
        `Cordiali saluti,\nFederico\nTurboReplies`
      ];
      return {
        subject: firstSubject(vertical, true, property),
        text: paragraphs.join("\n\n"),
        html: paragraphsToHtml([
          `${greeting},`,
          `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} da TurboReplies. ${valueParagraph(vertical, true, multipleRecipients)}`,
          `Guardando ${property}, ho pensato che potesse essere rilevante ${italianValuePronoun(multipleRecipients)}.`,
          hook,
          demoLineHtml(true, url),
          offer,
          `Cordiali saluti,<br />Federico<br />TurboReplies`
        ])
      };
    }

    const offer = `If you prefer, send me a question you often get from ${audienceNoun(vertical, false)} and I'll show you exactly how the assistant would reply for ${property}.`;
    return {
      subject: firstSubject(vertical, false, property),
      text: [
        `Hello,`,
        `I'm Federico from TurboReplies. ${valueParagraph(vertical, false, multipleRecipients)}`,
        `Looking at ${property}, I thought it could be relevant for you.${optionalHook(row)}`,
        demoLineText(false, url),
        offer,
        `Best,\nFederico\nTurboReplies`
      ].join("\n\n"),
      html: paragraphsToHtml([
        `Hello,`,
        `I'm Federico from TurboReplies. ${valueParagraph(vertical, false, multipleRecipients)}`,
        `Looking at ${property}, I thought it could be relevant for you.`,
        hook,
        demoLineHtml(false, url),
        offer,
        `Best,<br />Federico<br />TurboReplies`
      ])
    };
  }

  if (followUpStep === 1) {
    if (italian) {
      const lead = `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} di nuovo sul mio messaggio precedente: per ${property}, TurboReplies ${shortBenefit(vertical, true, multipleRecipients)}.`;
      return {
        subject: `Riprendo il mio messaggio su ${property}`,
        text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
        html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
      };
    }

    const lead = `Following up on my note: for ${property}, TurboReplies ${shortBenefit(vertical, false, multipleRecipients)}.`;
    return {
      subject: `Following up on ${property}`,
      text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
    };
  }

  if (followUpStep === 2) {
    if (italian) {
      const lead = `${multipleRecipients ? "Vi scrivo" : "Le scrivo"} ancora una volta. Se in questo momento non è una priorità per ${property}, nessun problema. Se invece può avere senso, la demo di un minuto mostra in concreto come l'assistente gestirebbe i vostri ${audienceNoun(vertical, true)}.`;
      return {
        subject: `Posso chiudere il cerchio su ${property}?`,
        text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
        html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
      };
    }

    const lead = `Just checking once more. If this is not a priority for ${property} right now, no problem at all. If it is worth a look, the one-minute demo shows exactly how the assistant would handle your ${audienceNoun(vertical, false)}.`;
    return {
      subject: `Should I close the loop on ${property}?`,
      text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
    };
  }

  if (italian) {
    const lead = `Chiudo il cerchio con quest'ultimo messaggio. Se TurboReplies può essere utile per ${property}, ${multipleRecipients ? "potete rispondermi qui o aprire la demo" : "può rispondermi qui o aprire la demo"} qui sotto. In caso contrario, non ${multipleRecipients ? "vi" : "La"} ricontatterò oltre.`;
    return {
      subject: `Ultimo messaggio per ${property}`,
      text: [`${greeting},`, lead, demoLineText(true, url), `Cordiali saluti,\nFederico`].join("\n\n"),
      html: paragraphsToHtml([`${greeting},`, lead, demoLineHtml(true, url), `Cordiali saluti,<br />Federico`])
    };
  }

  const lead = `I'll close the loop after this note. If TurboReplies could be useful for ${property}, reply here or open the demo below. Otherwise I won't follow up again.`;
  return {
    subject: `Last follow-up for ${property}`,
    text: [`Hello,`, lead, demoLineText(false, url), `Best,\nFederico`].join("\n\n"),
    html: paragraphsToHtml([`Hello,`, lead, demoLineHtml(false, url), `Best,<br />Federico`])
  };
}
