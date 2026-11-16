export const PERIODS = ['morning', 'afternoon', 'evening'] as const;
export type Period = (typeof PERIODS)[number];
export type CheckinStatus = 'empty' | 'checked-in' | 'completed';

export interface CheckinRecord {
  id: string;
  date: string;
  period: Period;
  checkIn: string | null;
  checkOut: string | null;
  note: string;
  photoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredPhoto {
  id: string;
  recordId: string;
  blob: Blob;
  mimeType: string;
  createdAt: string;
}

export interface EditableFields {
  checkIn: string;
  checkOut: string;
  note: string;
}

export interface ExportedPhoto {
  id: string;
  recordId: string;
  dataUrl: string;
  mimeType: string;
  createdAt: string;
}

export interface BackupFile {
  app: 'daily-checkin';
  version: 1;
  exportedAt: string;
  records: CheckinRecord[];
  photos?: ExportedPhoto[];
}

export interface ParsedBackup {
  records: CheckinRecord[];
  photos: StoredPhoto[] | null;
}

export type ImportMode = 'merge' | 'replace';
export type MessageKind = 'success' | 'error' | 'info';
