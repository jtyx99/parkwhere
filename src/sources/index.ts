import { hdbSource } from './hdb';
import { LTA_API_BASE, ltaSource } from './lta';
import type { CarparkSource, SourceId } from './types';

/** Sources in use. LTA joins once a proxy URL is configured. */
export const sources: CarparkSource[] = LTA_API_BASE ? [hdbSource, ltaSource] : [hdbSource];

export const sourceById = (id: SourceId) => sources.find((s) => s.id === id)!;
