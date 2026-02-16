
export interface ScannedRecord {
  id: string;
  partNumber: string;
  uniqueCode: string;
  timestamp: string;
  status: 'pending' | 'synced';
  analysis?: string;
}

export interface ScanSession {
  partNumber: string | null;
  uniqueCode: string | null;
}

export enum ScanTarget {
  PART_NUMBER = 'partNumber',
  UNIQUE_CODE = 'uniqueCode'
}
