import { describe, it, expect } from 'vitest';
import { clamp, toAngleLabel } from './angles.js';
import { normalizeHoldName } from './holds.js';
import { isSafeRasterDataUrl, isStrongAdminPassword } from './validation.js';

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

describe('normalizeHoldName', () => {
  it('trims whitespace', () => {
    expect(normalizeHoldName('  crimp  ')).toBe('crimp');
  });
  it('collapses internal spaces', () => {
    expect(normalizeHoldName('big  jug')).toBe('big jug');
  });
  it('handles null', () => {
    expect(normalizeHoldName(null)).toBe('');
  });
  it('handles undefined', () => {
    expect(normalizeHoldName(undefined)).toBe('');
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

describe('isStrongAdminPassword', () => {
  it('accepts valid 4-digit PIN', () => expect(isStrongAdminPassword('5823')).toBe(true));
  it('rejects non-digits', () => expect(isStrongAdminPassword('abcd')).toBe(false));
  it('rejects weak PIN 1234', () => expect(isStrongAdminPassword('1234')).toBe(false));
  it('rejects repeating 0000', () => expect(isStrongAdminPassword('0000')).toBe(false));
  it('rejects too short', () => expect(isStrongAdminPassword('123')).toBe(false));
  it('rejects too long', () => expect(isStrongAdminPassword('12345')).toBe(false));
});
