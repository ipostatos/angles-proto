import { describe, it, expect } from 'vitest';

// Helpers copied inline from src/App.jsx for isolated unit testing
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function toAngleLabel(n) {
  const isInt = Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
  return isInt ? `${Math.round(Number(n))}°` : `${Number(n).toFixed(1)}°`;
}
function normalizeHoldNameSafe(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}
function isSafeRasterDataUrl(s) {
  return typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);/i.test(s);
}

describe('clamp', () => {
  it('clamps to min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });
  it('clamps to max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });
  it('passes through in range', () => {
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

describe('toAngleLabel', () => {
  it('formats integer as whole number', () => {
    expect(toAngleLabel(45)).toBe('45°');
  });
  it('formats decimal', () => {
    expect(toAngleLabel(28.2)).toBe('28.2°');
  });
});

describe('normalizeHoldNameSafe', () => {
  it('trims whitespace', () => {
    expect(normalizeHoldNameSafe('  crimp  ')).toBe('crimp');
  });
  it('collapses internal spaces', () => {
    expect(normalizeHoldNameSafe('big  jug')).toBe('big jug');
  });
  it('handles null', () => {
    expect(normalizeHoldNameSafe(null)).toBe('');
  });
  it('handles undefined', () => {
    expect(normalizeHoldNameSafe(undefined)).toBe('');
  });
});

describe('isSafeRasterDataUrl', () => {
  it('accepts PNG data URL', () => {
    expect(isSafeRasterDataUrl('data:image/png;base64,abc')).toBe(true);
  });
  it('accepts JPEG data URL', () => {
    expect(isSafeRasterDataUrl('data:image/jpeg;base64,abc')).toBe(true);
  });
  it('rejects SVG', () => {
    expect(isSafeRasterDataUrl('data:image/svg+xml;base64,abc')).toBe(false);
  });
  it('rejects plain string', () => {
    expect(isSafeRasterDataUrl('https://example.com/image.png')).toBe(false);
  });
});
