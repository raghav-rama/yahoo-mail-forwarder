import { describe, expect, it } from "vitest";
import { parseEmailSource, sanitizeEmailBody } from "../src/email/parser.js";

describe("email parser", () => {
  it("prefers plain text, strips quoted replies, and keeps attachment metadata only", async () => {
    const parsed = await parseEmailSource(`From: Alice <alice@example.com>
To: Me <me@yahoo.com>
Subject: Need a reply
Message-ID: <msg-1@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000
Content-Type: multipart/mixed; boundary=OUTER

--OUTER
Content-Type: multipart/alternative; boundary=INNER

--INNER
Content-Type: text/plain; charset=utf-8

Hi, can you send the document today?

On Sun, Bob wrote:
> older thread text

--INNER
Content-Type: text/html; charset=utf-8

<html><body><p>HTML fallback</p><script>alert('x')</script></body></html>
--INNER--
--OUTER
Content-Type: application/pdf
Content-Disposition: attachment; filename="contract.pdf"
Content-Transfer-Encoding: base64

SGVsbG8=
--OUTER--`);

    expect(parsed.subject).toBe("Need a reply");
    expect(parsed.messageId).toBe("<msg-1@example.com>");
    expect(parsed.bodyText).toBe("Hi, can you send the document today?");
    expect(parsed.attachments).toEqual([
      {
        filename: "contract.pdf",
        contentType: "application/pdf",
        size: 5,
        checksum: expect.any(String)
      }
    ]);
  });

  it("falls back to sanitized HTML and truncates long bodies", () => {
    const body = sanitizeEmailBody(
      "<html><head><style>.x{}</style></head><body><p>Hello&nbsp;<b>there</b></p><a href=\"https://example.com?utm_source=x\">track</a></body></html>",
      12
    );

    expect(body).toBe("Hello there");
  });
});
