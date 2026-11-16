import type { CheckinRecord, ImportMode, ParsedBackup, StoredPhoto } from './types';

const DATABASE_NAME = 'daily-checkin';
const DATABASE_VERSION = 1;
const RECORD_STORE = 'records';
const PHOTO_STORE = 'photos';

let cachedDatabase: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!cachedDatabase) {
    cachedDatabase = new Promise<IDBDatabase>((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前浏览器不支持 IndexedDB，请使用新版浏览器。'));
        return;
      }

      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          database.createObjectStore(RECORD_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(PHOTO_STORE)) {
          const store = database.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
          store.createIndex('recordId', 'recordId', { unique: false });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          cachedDatabase = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败。'));
      request.onblocked = () => reject(new Error('数据库被其他页面占用，请关闭其他标签页后刷新。'));
    }).catch((error: unknown) => {
      cachedDatabase = null;
      throw error;
    });
  }
  return cachedDatabase;
}

function waitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('读取本地数据失败。'));
  });
}

function waitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('数据库操作失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('数据库操作已取消。'));
  });
}

export async function getAllRecords(): Promise<CheckinRecord[]> {
  const database = await openDatabase();
  return waitRequest(database.transaction(RECORD_STORE, 'readonly')
    .objectStore(RECORD_STORE).getAll() as IDBRequest<CheckinRecord[]>);
}

export async function getAllPhotos(): Promise<StoredPhoto[]> {
  const database = await openDatabase();
  return waitRequest(database.transaction(PHOTO_STORE, 'readonly')
    .objectStore(PHOTO_STORE).getAll() as IDBRequest<StoredPhoto[]>);
}

export async function getPhotosByRecord(recordId: string): Promise<StoredPhoto[]> {
  const database = await openDatabase();
  const request = database.transaction(PHOTO_STORE, 'readonly')
    .objectStore(PHOTO_STORE).index('recordId').getAll(recordId);
  return waitRequest(request as IDBRequest<StoredPhoto[]>);
}

export async function putRecord(record: CheckinRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(RECORD_STORE, 'readwrite');
  const done = waitTransaction(transaction);
  transaction.objectStore(RECORD_STORE).put(record);
  await done;
}

export async function putRecordWithPhotos(
  record: CheckinRecord,
  photos: StoredPhoto[],
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([RECORD_STORE, PHOTO_STORE], 'readwrite');
  const done = waitTransaction(transaction);
  transaction.objectStore(RECORD_STORE).put(record);
  for (const photo of photos) transaction.objectStore(PHOTO_STORE).put(photo);
  await done;
}

export async function removePhoto(
  record: CheckinRecord,
  photoId: string,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([RECORD_STORE, PHOTO_STORE], 'readwrite');
  const done = waitTransaction(transaction);
  transaction.objectStore(RECORD_STORE).put(record);
  transaction.objectStore(PHOTO_STORE).delete(photoId);
  await done;
}

export async function clearPeriod(recordId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([RECORD_STORE, PHOTO_STORE], 'readwrite');
  const done = waitTransaction(transaction);
  transaction.objectStore(RECORD_STORE).delete(recordId);

  // 用索引删除关联照片，避免遗留孤立 Blob。
  const request = transaction.objectStore(PHOTO_STORE)
    .index('recordId').openCursor(IDBKeyRange.only(recordId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await done;
}

export async function clearEverything(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([RECORD_STORE, PHOTO_STORE], 'readwrite');
  const done = waitTransaction(transaction);
  transaction.objectStore(RECORD_STORE).clear();
  transaction.objectStore(PHOTO_STORE).clear();
  await done;
}

export async function importIntoDatabase(
  backup: ParsedBackup,
  mode: ImportMode,
): Promise<void> {
  // 所有异步解码都已在开始事务前完成，避免事务因 await 而自动关闭。
  const previous = mode === 'merge' ? await getAllRecords() : [];
  const previousMap = new Map(previous.map((record) => [record.id, record]));
  const withPhotos = backup.photos !== null;
  const database = await openDatabase();
  const transaction = database.transaction([RECORD_STORE, PHOTO_STORE], 'readwrite');
  const done = waitTransaction(transaction);
  const records = transaction.objectStore(RECORD_STORE);
  const photos = transaction.objectStore(PHOTO_STORE);

  if (mode === 'replace') {
    records.clear();
    photos.clear();
  }

  for (const record of backup.records) {
    const oldRecord = previousMap.get(record.id);
    const nextPhotoIds = withPhotos
      ? record.photoIds
      : mode === 'merge'
        ? oldRecord?.photoIds ?? []
        : [];

    if (mode === 'merge' && withPhotos && oldRecord) {
      for (const oldPhotoId of oldRecord.photoIds) {
        if (!nextPhotoIds.includes(oldPhotoId)) photos.delete(oldPhotoId);
      }
    }
    records.put({ ...record, photoIds: [...nextPhotoIds] });
  }

  if (backup.photos) {
    for (const photo of backup.photos) photos.put(photo);
  }
  await done;
}

async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`无法读取图片：${file.name}。请尝试 JPEG 或 PNG。`));
      element.src = url;
    });

    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longest) throw new Error('图片尺寸无效。');
    const scale = Math.min(1, 1280 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持图片压缩。');
    // 将透明图层铺成白色，避免转换为 JPEG 后背景变黑。
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressPhoto(file: File, recordId: string): Promise<StoredPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`「${file.name}」不是受支持的图片文件。`);
  }
  const canvas = await imageToCanvas(file);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('图片压缩失败。')),
      'image/jpeg',
      0.8,
    );
  });
  return {
    id: crypto.randomUUID(),
    recordId,
    blob,
    mimeType: 'image/jpeg',
    createdAt: new Date().toISOString(),
  };
}
