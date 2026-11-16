import { getAllPhotos, getAllRecords } from './db';
import type {
  BackupFile, CheckinRecord, ExportedPhoto, ParsedBackup, Period, StoredPhoto,
} from './types';
import { getRecordId, isValidDate, validateTimes } from './utils';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取备份照片失败。'));
    reader.readAsDataURL(blob);
  });
}

export async function buildBackup(includePhotos: boolean): Promise<BackupFile> {
  const records = await getAllRecords();
  const backup: BackupFile = {
    app: 'daily-checkin',
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
  };

  if (includePhotos) {
    const photos = await getAllPhotos();
    backup.photos = await Promise.all(photos.map(async (photo): Promise<ExportedPhoto> => ({
      id: photo.id,
      recordId: photo.recordId,
      mimeType: photo.mimeType,
      createdAt: photo.createdAt,
      dataUrl: await blobToDataUrl(photo.blob),
    })));
  }
  return backup;
}

export function downloadBackup(backup: BackupFile): void {
  const content = JSON.stringify(backup, null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `daily-checkin-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPeriod(value: unknown): value is Period {
  return value === 'morning' || value === 'afternoon' || value === 'evening';
}

function parseRecord(raw: unknown, index: number): CheckinRecord {
  if (!isObject(raw)) throw new Error(`第 ${index + 1} 条记录不是有效对象。`);
  const { id, date, period, checkIn, checkOut, note, photoIds, createdAt, updatedAt } = raw;
  if (typeof date !== 'string' || !isValidDate(date) || !isPeriod(period)
    || typeof id !== 'string' || id !== getRecordId(date, period)) {
    throw new Error(`第 ${index + 1} 条记录的日期、时段或 ID 无效。`);
  }
  if (!((checkIn === null || typeof checkIn === 'string')
    && (checkOut === null || typeof checkOut === 'string'))) {
    throw new Error(`第 ${index + 1} 条记录的时间字段无效。`);
  }
  const issue = validateTimes(checkIn, checkOut);
  if (issue) throw new Error(`第 ${index + 1} 条记录：${issue}`);
  if (!Array.isArray(photoIds) || !photoIds.every((v) => typeof v === 'string')) {
    throw new Error(`第 ${index + 1} 条记录的 photoIds 无效。`);
  }
  if (new Set(photoIds).size !== photoIds.length) {
    throw new Error(`第 ${index + 1} 条记录包含重复的照片 ID。`);
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new Error(`第 ${index + 1} 条记录的备注无效。`);
  }
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    throw new Error(`第 ${index + 1} 条记录缺少时间戳。`);
  }
  return {
    id, date, period, checkIn, checkOut, note: note ?? '',
    photoIds: [...photoIds], createdAt, updatedAt,
  };
}

function decodePhoto(raw: unknown, index: number): StoredPhoto {
  if (!isObject(raw)) throw new Error(`第 ${index + 1} 张照片不是有效对象。`);
  const { id, recordId, mimeType, createdAt, dataUrl } = raw;
  if (typeof id !== 'string' || !id || typeof recordId !== 'string'
    || typeof createdAt !== 'string' || typeof mimeType !== 'string'
    || typeof dataUrl !== 'string') {
    throw new Error(`第 ${index + 1} 张照片的字段不完整。`);
  }
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
    throw new Error(`第 ${index + 1} 张照片的数据格式不受支持。`);
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(match[2].replace(/\s/g, ''));
    if (binary.length > 30 * 1024 * 1024) {
      throw new Error('单张备份照片超过 30MB，已拒绝导入。');
    }
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch (error) {
    if (error instanceof Error && error.message.includes('30MB')) throw error;
    throw new Error(`第 ${index + 1} 张照片的 Base64 数据损坏。`);
  }
  return { id, recordId, mimeType, createdAt, blob: new Blob([bytes], { type: mimeType }) };
}

export async function parseBackup(file: File): Promise<ParsedBackup> {
  let payload: unknown;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('文件不是有效的 JSON，请选择本项目导出的备份文件。');
  }
  if (!isObject(payload) || payload.app !== 'daily-checkin' || payload.version !== 1
    || !Array.isArray(payload.records)) {
    throw new Error('备份格式或版本不正确，当前只支持 daily-checkin v1。');
  }

  const records = payload.records.map(parseRecord);
  const recordMap = new Map(records.map((record) => [record.id, record]));
  if (recordMap.size !== records.length) throw new Error('备份中存在重复的日期和时段。');

  if (payload.photos === undefined) return { records, photos: null };
  if (!Array.isArray(payload.photos)) throw new Error('备份照片列表格式不正确。');

  const photos = payload.photos.map(decodePhoto);
  const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
  if (photoMap.size !== photos.length) throw new Error('备份中存在重复的照片 ID。');

  for (const record of records) {
    for (const photoId of record.photoIds) {
      const photo = photoMap.get(photoId);
      if (!photo || photo.recordId !== record.id) {
        throw new Error(`记录 ${record.id} 引用了不存在或不匹配的照片。`);
      }
    }
  }
  for (const photo of photos) {
    const record = recordMap.get(photo.recordId);
    if (!record || !record.photoIds.includes(photo.id)) {
      throw new Error(`照片 ${photo.id} 没有对应的记录。`);
    }
  }
  return { records, photos };
}
