import { beforeEach, describe, expect, it } from 'vitest';
import type { CloudJob } from '@/api/cloud-import';
import {
  computeRate, etaSeconds, humanDuration, jobRate, recordSamples, resetImportRateSamples,
} from './import-rate';

function job(overrides: Partial<CloudJob>): CloudJob {
  return {
    id: 'cij_1',
    provider: 'onedrive',
    account_email: 'o@example.com',
    workspace_id: 'ws_1',
    status: 'running',
    total_files: 10,
    total_bytes: 10_000_000,
    total_folders: 0,
    completed_files: 2,
    completed_bytes: 0,
    failed_files: 0,
    skipped_files: 0,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

beforeEach(() => resetImportRateSamples());

describe('computeRate', () => {
  it('returns null with fewer than two samples', () => {
    expect(computeRate([])).toBeNull();
    expect(computeRate([{ t: 0, bytes: 100 }])).toBeNull();
  });

  it('returns null when the window is narrower than 3s', () => {
    expect(computeRate([{ t: 0, bytes: 0 }, { t: 2_000, bytes: 1_000 }])).toBeNull();
  });

  it('computes bytes/sec across the whole window', () => {
    const rate = computeRate([
      { t: 0, bytes: 0 },
      { t: 5_000, bytes: 5_000_000 },
      { t: 10_000, bytes: 20_000_000 },
    ]);
    expect(rate).toBe(2_000_000);
  });

  it('reports a stall (or counter reset) as 0, never a negative rate', () => {
    expect(computeRate([{ t: 0, bytes: 500 }, { t: 5_000, bytes: 500 }])).toBe(0);
    expect(computeRate([{ t: 0, bytes: 500 }, { t: 5_000, bytes: 100 }])).toBe(0);
  });
});

describe('etaSeconds', () => {
  it('is null without a usable rate', () => {
    expect(etaSeconds(null, 1_000, 0)).toBeNull();
    expect(etaSeconds(0, 1_000, 0)).toBeNull();
  });

  it('is null when the total is unknown or already reached', () => {
    expect(etaSeconds(100, 0, 0)).toBeNull();
    expect(etaSeconds(100, 1_000, 1_000)).toBeNull();
  });

  it('rounds the remaining time up to whole seconds', () => {
    expect(etaSeconds(1_000, 10_500, 500)).toBe(10);
    expect(etaSeconds(3_000, 10_000, 0)).toBe(4);
  });
});

describe('humanDuration', () => {
  it('formats seconds, minutes and hours at the "about" scale', () => {
    expect(humanDuration(45)).toBe('45s');
    expect(humanDuration(240)).toBe('4m');
    expect(humanDuration(3_600)).toBe('1h');
    expect(humanDuration(4_800)).toBe('1h 20m');
  });
});

describe('recordSamples + jobRate', () => {
  it('builds a window from successive polls and yields speed and ETA', () => {
    const j = (bytes: number) => job({ completed_bytes: bytes });
    recordSamples([j(0)], 0);
    recordSamples([j(5_000_000)], 5_000);
    recordSamples([j(10_000_000)], 10_000);

    const rate = jobRate(j(10_000_000));
    expect(rate.bytesPerSec).toBe(1_000_000);
    // completed_bytes equals total_bytes here, so no honest ETA remains.
    expect(rate.etaSeconds).toBeNull();

    const midway = jobRate(job({ completed_bytes: 5_000_000 }));
    expect(midway.etaSeconds).toBe(5);
  });

  it('dedupes samples closer than a second apart', () => {
    const j = job({ completed_bytes: 100 });
    recordSamples([j], 0);
    recordSamples([j], 200);
    recordSamples([j], 400);
    // Only the first sample stuck, so there is no window yet.
    expect(jobRate(j).bytesPerSec).toBeNull();
  });

  it('caps the window at 8 samples, dropping the oldest', () => {
    for (let i = 0; i < 12; i++) {
      recordSamples([job({ completed_bytes: i * 1_000 })], i * 5_000);
    }
    // Window is samples 4..11: (11k - 4k) bytes over (55k - 20k) ms = 200 B/s.
    expect(jobRate(job({ completed_bytes: 11_000 })).bytesPerSec).toBe(200);
  });

  it('prunes jobs that are no longer running', () => {
    recordSamples([job({ completed_bytes: 0 })], 0);
    recordSamples([job({ completed_bytes: 5_000 })], 5_000);
    recordSamples([job({ status: 'complete', completed_bytes: 10_000 })], 10_000);
    recordSamples([job({ completed_bytes: 12_000 })], 15_000);
    // The window restarted after the terminal snapshot pruned it.
    expect(jobRate(job({ completed_bytes: 12_000 })).bytesPerSec).toBeNull();
  });

  it('only samples running jobs, never discovering ones', () => {
    recordSamples([job({ status: 'discovering' })], 0);
    recordSamples([job({ status: 'discovering' })], 5_000);
    expect(jobRate(job({ status: 'discovering' })).bytesPerSec).toBeNull();
  });
});
