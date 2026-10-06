/**
 * Unit tests for channel-specific message formatting logic.
 */

// Re-implement the splitSmsMessage logic for isolated testing
// (mirrors lib/lambda/channel-sender/index.ts)
function splitSmsMessage(text: string, maxLen = 160): string[] {
  if (text.length <= maxLen) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.6) splitAt = maxLen;
    segments.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }
  return segments;
}

describe('SMS message splitting', () => {
  test('short message stays as one segment', () => {
    const result = splitSmsMessage('Your renewal is due soon.');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Your renewal is due soon.');
  });

  test('long message splits at word boundaries', () => {
    const long =
      'Maria, your SNAP renewal is due in 14 days. You still need to submit your proof of income and a recent utility bill. Reply RENEW to start the process or text HELP if you have any questions about what documents are acceptable.';
    const result = splitSmsMessage(long);
    expect(result.length).toBeGreaterThan(1);
    // No segment exceeds the limit
    for (const seg of result) {
      expect(seg.length).toBeLessThanOrEqual(160);
    }
    // Reassembly preserves content (modulo whitespace)
    expect(result.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
  });

  test('message exactly at limit stays one segment', () => {
    const exact = 'a'.repeat(160);
    const result = splitSmsMessage(exact);
    expect(result).toHaveLength(1);
  });

  test('handles very long single word without infinite loop', () => {
    const result = splitSmsMessage('x'.repeat(400));
    expect(result.length).toBe(3);
  });
});

describe('WhatsApp phone normalization', () => {
  function toWhatsApp(e164: string): string {
    return e164.replace('+', '');
  }
  function fromWhatsApp(waNumber: string): string {
    return `+${waNumber}`;
  }

  test('strips + prefix for outbound', () => {
    expect(toWhatsApp('+15551234567')).toBe('15551234567');
  });

  test('adds + prefix for inbound normalization', () => {
    expect(fromWhatsApp('15551234567')).toBe('+15551234567');
  });

  test('round trip preserves number', () => {
    const original = '+15035551000';
    expect(fromWhatsApp(toWhatsApp(original))).toBe(original);
  });
});

describe('Email recipient ID encoding', () => {
  function extractRecipientId(to: string): string | null {
    const match = to.match(/benefits\+(\+?\d{10,15})@/);
    if (match) return match[1].startsWith('+') ? match[1] : `+${match[1]}`;
    return null;
  }

  test('extracts phone from plus-addressed email', () => {
    expect(extractRecipientId('benefits+15551234567@example.com')).toBe('+15551234567');
  });

  test('returns null for non-encoded address', () => {
    expect(extractRecipientId('support@example.com')).toBeNull();
  });
});
