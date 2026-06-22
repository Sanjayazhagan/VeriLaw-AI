export interface PiiMapping {
  placeholder: string;
  original: string;
  type: string;
}

/**
 * Scrubs PII from raw contract text.
 * Replaces names, emails, phone numbers, and tax IDs with placeholders.
 * Returns the scrubbed text and a mapping array for visualization.
 */
export function scrubText(text: string): { scrubbedText: string; mapping: PiiMapping[] } {
  let tempText = text;
  const mapping: PiiMapping[] = [];
  let counter = 1;

  // 1. Redact Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailsFound = Array.from(new Set(tempText.match(emailRegex) || []));
  emailsFound.forEach(email => {
    const placeholder = `[REDACTED_EMAIL_${counter++}]`;
    tempText = tempText.split(email).join(placeholder);
    mapping.push({ placeholder, original: email, type: 'Email' });
  });

  // 2. Redact Phone Numbers
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phonesFound = Array.from(new Set(tempText.match(phoneRegex) || []));
  phonesFound.forEach(phone => {
    const digitCount = phone.replace(/\D/g, '').length;
    if (digitCount >= 7 && digitCount <= 15) {
      const placeholder = `[REDACTED_PHONE_${counter++}]`;
      tempText = tempText.split(phone).join(placeholder);
      mapping.push({ placeholder, original: phone, type: 'Phone' });
    }
  });

  // 3. Redact Tax IDs / SSNs
  const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
  const ssnsFound = Array.from(new Set(tempText.match(ssnRegex) || []));
  ssnsFound.forEach(ssn => {
    const placeholder = `[REDACTED_TAX_ID_${counter++}]`;
    tempText = tempText.split(ssn).join(placeholder);
    mapping.push({ placeholder, original: ssn, type: 'Tax ID' });
  });

  // 4. Redact Names & Corporate Entities
  const commonNamePatterns = [
    // Mr./Ms./Mrs./Dr. Names
    /(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][A-Za-z0-9.' \t-]+)/g,
    
    // Label-based Names (supporting initials, suffix, spaces/tabs, case-insensitive labels)
    /(?:Name|Representative|Officer|Employee|Consultant|Director|Employer|Contractor|Client|By):\s*([A-Z][A-Za-z0-9.' \t-]+)/gi,
    
    // Corporate Entities (e.g. Acme Corp, Global Tech LLC, Nimbus Cloud Solutions)
    /\b([A-Z0-9][A-Za-z0-9.&' \t-]{1,50}\s+(?:LLC|L\.L\.C\.|Inc\.|Inc|Corp\.|Corp|Co\.|Co|Ltd\.|Ltd|Corporation|Incorporated|Company|Technologies|Solutions|Partners))\b/gi
  ];

  const candidates: string[] = [];
  commonNamePatterns.forEach(pattern => {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(tempText)) !== null) {
      const originalName = match[1].trim();
      if (originalName && !originalName.includes('[REDACTED') && originalName.length > 2) {
        candidates.push(originalName);
      }
    }
  });

  // Sort candidates by length descending to prevent substring collisions during replacements
  const sortedCandidates = Array.from(new Set(candidates)).sort((a, b) => b.length - a.length);

  sortedCandidates.forEach(originalName => {
    if (tempText.includes(originalName)) {
      const placeholder = `[REDACTED_NAME_${counter++}]`;
      tempText = tempText.split(originalName).join(placeholder);
      mapping.push({ placeholder, original: originalName, type: 'Name' });
    }
  });

  // Deduplicate mapping records to prevent multiple records for same values
  const uniqueMapping: PiiMapping[] = [];
  const seenPlaceholders = new Set<string>();
  mapping.forEach(m => {
    if (!seenPlaceholders.has(m.placeholder)) {
      seenPlaceholders.add(m.placeholder);
      uniqueMapping.push(m);
    }
  });

  return {
    scrubbedText: tempText,
    mapping: uniqueMapping
  };
}
