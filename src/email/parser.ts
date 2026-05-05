import { createHash } from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

export type AttachmentMetadata = {
  filename?: string;
  contentType?: string;
  size?: number;
  checksum?: string;
};

export type ParsedEmail = {
  messageId?: string;
  subject: string;
  fromAddress?: string;
  fromName?: string;
  toAddresses: string[];
  replyToAddresses: string[];
  date?: Date;
  inReplyTo?: string;
  references: string[];
  bodyText: string;
  bodyHash: string;
  attachments: AttachmentMetadata[];
  headers: Map<string, string>;
};

export async function parseEmailSource(source: Buffer | string, maxBodyChars = 12_000): Promise<ParsedEmail> {
  const mail = await simpleParser(source);
  const bodyText = sanitizeEmailBody(selectBody(mail), maxBodyChars);
  const from = mail.from?.value[0];

  return {
    messageId: mail.messageId,
    subject: mail.subject ?? "",
    fromAddress: from?.address?.toLowerCase(),
    fromName: from?.name,
    toAddresses: flattenAddresses(mail.to).map((address) => address.address?.toLowerCase()).filter(isPresent),
    replyToAddresses: mail.replyTo?.value.map((address) => address.address?.toLowerCase()).filter(isPresent) ?? [],
    date: mail.date,
    inReplyTo: mail.inReplyTo,
    references: normalizeReferences(mail.references),
    bodyText,
    bodyHash: hashText(bodyText),
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      checksum: attachment.checksum
    })),
    headers: normalizeHeaders(mail.headers)
  };
}

export function sanitizeEmailBody(input: string | false | undefined, maxChars = 12_000): string {
  if (!input) {
    return "";
  }

  const withoutHtml = stripHtml(input);
  const withoutQuoted = stripQuotedReplies(withoutHtml);
  const withoutTrackingUrls = withoutQuoted.replace(/https?:\/\/\S*(?:utm_[^\s&]+|trk|tracking)[^\s]*/gi, "");
  const normalized = decodeHtmlEntities(withoutTrackingUrls)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return truncateAtWordBoundary(normalized, maxChars);
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function selectBody(mail: ParsedMail): string {
  if (mail.text?.trim()) {
    return mail.text;
  }

  if (typeof mail.html === "string" && mail.html.trim()) {
    return mail.html;
  }

  return "";
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<a\b[^>]*href=["'][^"']*(?:utm_[^"']*|trk|tracking)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function stripQuotedReplies(input: string): string {
  const quoteStartPatterns = [
    /\nOn .+ wrote:\s*$/im,
    /\nFrom:\s.+$/im,
    /\n-{2,}\s*Original Message\s*-{2,}/im
  ];
  const firstQuoteIndex = quoteStartPatterns
    .map((pattern) => input.search(pattern))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const withoutReplyBlock = firstQuoteIndex === undefined ? input : input.slice(0, firstQuoteIndex);

  return withoutReplyBlock
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n--\s*\n[\s\S]*$/m, "");
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function truncateAtWordBoundary(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }

  const truncated = input.slice(0, maxChars).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

function normalizeHeaders(headers: ParsedMail["headers"]): Map<string, string> {
  const normalized = new Map<string, string>();

  for (const [key, value] of headers.entries()) {
    normalized.set(key.toLowerCase(), headerValueToString(value));
  }

  return normalized;
}

function headerValueToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(headerValueToString).join(" ");
  }

  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }

  return JSON.stringify(value);
}

function normalizeReferences(references: string[] | string | undefined): string[] {
  if (!references) {
    return [];
  }

  return Array.isArray(references) ? references : [references];
}

function flattenAddresses(addresses: AddressObject | AddressObject[] | undefined): AddressObject["value"] {
  if (!addresses) {
    return [];
  }

  const addressObjects = Array.isArray(addresses) ? addresses : [addresses];
  return addressObjects.flatMap((address) => address.value);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
