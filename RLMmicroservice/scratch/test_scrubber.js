function scrubText(text) {
  let tempText = text;
  const mapping = [];
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
    
    // Label-based Names
    /(?:Name|Representative|Officer|Employee|Consultant|Director|Employer|Contractor|Client|By):\s*([A-Z][A-Za-z0-9.' \t-]+)/gi,
    
    // Corporate Entities
    /\b([A-Z0-9][A-Za-z0-9.&' \t-]{1,50}\s+(?:LLC|L\.L\.C\.|Inc\.|Inc|Corp\.|Corp|Co\.|Co|Ltd\.|Ltd|Corporation|Incorporated|Company|Technologies|Solutions|Partners))\b/gi
  ];

  const candidates = [];
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

  const sortedCandidates = Array.from(new Set(candidates)).sort((a, b) => b.length - a.length);

  sortedCandidates.forEach(originalName => {
    if (tempText.includes(originalName)) {
      const placeholder = `[REDACTED_NAME_${counter++}]`;
      tempText = tempText.split(originalName).join(placeholder);
      mapping.push({ placeholder, original: originalName, type: 'Name' });
    }
  });

  const uniqueMapping = [];
  const seenPlaceholders = new Set();
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

const sampleText = `
ACME CORP
Signature: _________________________________
Name: John A. Carter
Title: Chief Operating Officer
Date: June 20, 2026

GLOBAL TECH LLC
Signature: _________________________________
Name: Priya R. Mehta
Title: VP of Business Development
Date: June 20, 2026
`;

console.log("RUNNING SCRUBBER TEST...");
const result = scrubText(sampleText);
console.log("MAPPING:");
console.log(result.mapping);
console.log("\nSCRUBBED TEXT:");
console.log(result.scrubbedText);
