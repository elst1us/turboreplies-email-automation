import { EmailContent, OutreachRow } from "./types";

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

export function buildEmail(row: OutreachRow, followUpStep: number): EmailContent {
  const italian = isItalian(row);
  const greeting = contactGreeting(row);
  const multipleRecipients = hasMultipleRecipients(row);
  const property = propertyLabel(row);
  const hook = String(row.cells.Hook || "").trim();

  if (followUpStep === 0) {
    if (italian) {
      const subject = `Una proposta per ${property}`;
      const text = `${greeting},

${multipleRecipients ? "Vi scrivo" : "Le scrivo"} da TurboReplies. Aiutiamo le strutture hospitality a gestire le risposte agli ospiti in modo più rapido e ordinato, senza aggiungere complessità operativa.

Guardando ${property}, ho pensato che il servizio potrebbe essere rilevante ${italianValuePronoun(multipleRecipients)}.${optionalHook(row)}

${multipleRecipients ? "Se lo ritenete utile, posso inviarvi" : "Se lo ritiene utile, posso inviarLe"} un esempio molto breve e concreto di come potrebbe funzionare nel vostro caso.

Cordiali saluti,
Federico
TurboReplies`;

      const html = `<p>${greeting},</p>
<p>${multipleRecipients ? "Vi scrivo" : "Le scrivo"} da TurboReplies. Aiutiamo le strutture hospitality a gestire le risposte agli ospiti in modo più rapido e ordinato, senza aggiungere complessità operativa.</p>
<p>Guardando ${property}, ho pensato che il servizio potrebbe essere rilevante ${italianValuePronoun(multipleRecipients)}.</p>
${hook ? `<p>${hook}</p>` : ""}
<p>${multipleRecipients ? "Se lo ritenete utile, posso inviarvi" : "Se lo ritiene utile, posso inviarLe"} un esempio molto breve e concreto di come potrebbe funzionare nel vostro caso.</p>
<p>Cordiali saluti,<br />Federico<br />TurboReplies</p>`;

      return { subject, text, html };
    }

    const subject = `A quick idea for ${property}`;
    const text = `Hello,

I’m Federico from TurboReplies. We help hospitality teams respond to guest messages faster without adding operational overhead.

I had a quick idea for ${property} and thought it could be relevant.${optionalHook(row)}

If it’s useful, I can send a short example of how this could work for your team.

Best,
Federico
TurboReplies`;

    const html = `<p>Hello,</p>
<p>I’m Federico from TurboReplies. We help hospitality teams respond to guest messages faster without adding operational overhead.</p>
<p>I had a quick idea for ${property} and thought it could be relevant.</p>
${hook ? `<p>${hook}</p>` : ""}
<p>If it’s useful, I can send a short example of how this could work for your team.</p>
<p>Best,<br />Federico<br />TurboReplies</p>`;

    return { subject, text, html };
  }

  if (followUpStep === 1) {
    if (italian) {
      return {
        subject: `Riprendo il mio messaggio su ${property}`,
        text: `${greeting},

${multipleRecipients ? "Vi scrivo" : "Le scrivo"} di nuovo in merito al mio messaggio precedente riguardo TurboReplies per ${property}.

Se ${multipleRecipients ? "per voi" : "per Lei"} ha senso migliorare velocità e qualità delle risposte agli ospiti, posso condividere un esempio molto breve e concreto.

Cordiali saluti,
Federico`,
        html: `<p>${greeting},</p>
<p>${multipleRecipients ? "Vi scrivo" : "Le scrivo"} di nuovo in merito al mio messaggio precedente riguardo TurboReplies per ${property}.</p>
<p>Se ${multipleRecipients ? "per voi" : "per Lei"} ha senso migliorare velocità e qualità delle risposte agli ospiti, posso condividere un esempio molto breve e concreto.</p>
<p>Cordiali saluti,<br />Federico</p>`
      };
    }

    return {
      subject: `Following up on ${property}`,
      text: `Hello,

Following up on my note about TurboReplies for ${property}.

If improving reply speed and consistency is a priority, I can share a very short example tailored to your setup.

Best,
Federico`,
      html: `<p>Hello,</p>
<p>Following up on my note about TurboReplies for ${property}.</p>
<p>If improving reply speed and consistency is a priority, I can share a very short example tailored to your setup.</p>
<p>Best,<br />Federico</p>`
    };
  }

  if (followUpStep === 2) {
    if (italian) {
      return {
        subject: `Posso chiudere il cerchio su ${property}?`,
        text: `${greeting},

${multipleRecipients ? "Vi scrivo" : "Le scrivo"} ancora una volta sul mio messaggio precedente.

Se in questo momento non è una priorità per ${property}, nessun problema. Se invece può avere senso, posso ${multipleRecipients ? "inviarvi" : "inviarLe"} una panoramica molto sintetica.

Cordiali saluti,
Federico`,
        html: `<p>${greeting},</p>
<p>${multipleRecipients ? "Vi scrivo" : "Le scrivo"} ancora una volta sul mio messaggio precedente.</p>
<p>Se in questo momento non è una priorità per ${property}, nessun problema. Se invece può avere senso, posso ${multipleRecipients ? "inviarvi" : "inviarLe"} una panoramica molto sintetica.</p>
<p>Cordiali saluti,<br />Federico</p>`
      };
    }

    return {
      subject: `Should I close the loop on ${property}?`,
      text: `Hello,

Just checking once more on my previous message.

If this is not a fit for ${property}, no problem at all. If it is worth a look, I can send a concise walkthrough.

Best,
Federico`,
      html: `<p>Hello,</p>
<p>Just checking once more on my previous message.</p>
<p>If this is not a fit for ${property}, no problem at all. If it is worth a look, I can send a concise walkthrough.</p>
<p>Best,<br />Federico</p>`
    };
  }

  if (italian) {
    return {
      subject: `Ultimo messaggio per ${property}`,
      text: `${greeting},

Chiudo il cerchio con quest'ultimo messaggio.

Se TurboReplies può essere utile per ${property}, ${multipleRecipients ? "potete rispondermi qui e vi mando" : "può rispondermi qui e Le mando"} volentieri i dettagli. In caso contrario, non ${multipleRecipients ? "vi" : "La"} ricontatterò oltre.

Cordiali saluti,
Federico`,
      html: `<p>${greeting},</p>
<p>Chiudo il cerchio con quest'ultimo messaggio.</p>
<p>Se TurboReplies può essere utile per ${property}, ${multipleRecipients ? "potete rispondermi qui e vi mando" : "può rispondermi qui e Le mando"} volentieri i dettagli. In caso contrario, non ${multipleRecipients ? "vi" : "La"} ricontatterò oltre.</p>
<p>Cordiali saluti,<br />Federico</p>`
    };
  }

  return {
    subject: `Last follow-up for ${property}`,
    text: `Hello,

I’ll close the loop after this note.

If TurboReplies could be useful for ${property}, reply here and I’ll send details. Otherwise I will not follow up again.

Best,
Federico`,
    html: `<p>Hello,</p>
<p>I’ll close the loop after this note.</p>
<p>If TurboReplies could be useful for ${property}, reply here and I’ll send details. Otherwise I will not follow up again.</p>
<p>Best,<br />Federico</p>`
  };
}
