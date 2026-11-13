import { hdbSource } from './hdb';
import { ltaEnabled, ltaSource } from './lta';
import type { CarparkSource, SourceId } from './types';

/** Sources in use. LTA joins when a snapshot URL or proxy is configured. */
export const sources: CarparkSource[] = ltaEnabled ? [hdbSource, ltaSource] : [hdbSource];

export const sourceById = (id: SourceId) => sources.find((s) => s.id === id)!;
