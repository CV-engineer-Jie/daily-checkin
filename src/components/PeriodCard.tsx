import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { getPhotosByRecord } from '../db';
import type {
  CheckinRecord, EditableFields, MessageKind, Period,
} from '../types';
import {
  describeError, getRecordId, getStatus, PERIOD_INFO, statusLabel, timeNow,
} from '../utils';

interface Props {
  date: string;
  period: Period;
  record?: CheckinRecord;
  revision: number;
  onSave: (date: string, period: Period, fields: EditableFields) => Promise<void>;
  onAddPhotos: (date: string, period: Period, files: File[]) => Promise<void>;
  onDeletePhoto: (date: string, period: Period, photoId: string) => Promise<void>;
  onClear: (date: string, period: Period) => Promise<void>;
  onToast: (message: string, kind?: MessageKind) => void;
}

interface PhotoPreview {
  id: string;
  url: string;
}

export default function PeriodCard({
  date, period, record, revision, onSave, onAddPhotos, onDeletePhoto, onClear, onToast,
}: Props) {
  const info = PERIOD_INFO[period];
  const recordId = getRecordId(date, period);
  const status = getStatus(record);
  const [checkIn, setCheckIn] = useState(record?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(record?.checkOut ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  const [working, setWorking] = useState(false);
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCheckIn(record?.checkIn ?? '');
    setCheckOut(record?.checkOut ?? '');
    setNote(record?.note ?? '');
  }, [record?.checkIn, record?.checkOut, record?.note, recordId]);

  const photoIdSignature = record?.photoIds.join('|') ?? '';
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setPhotosLoading(true);
    setPhotos([]);

    getPhotosByRecord(recordId)
      .then((stored) => {
        if (!active) return;
        const order = new Map((record?.photoIds ?? []).map((id, index) => [id, index]));
        const listed = stored
          .filter((photo) => order.has(photo.id))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        const previews = listed.map((photo) => {
          const url = URL.createObjectURL(photo.blob);
          urls.push(url);
          return { id: photo.id, url };
        });
        setPhotos(previews);
      })
      .catch(() => {
        if (active) onToast('读取照片失败，请尝试刷新页面。', 'error');
      })
      .finally(() => {
        if (active) setPhotosLoading(false);
      });

    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    // 照片内容以 ID 列表和导入后的 revision 为刷新依据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, photoIdSignature, revision, onToast]);

  async function perform(operation: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    try {
      await operation();
    } catch (error) {
      onToast(describeError(error), 'error');
    } finally {
      setWorking(false);
    }
  }

  const fields = (inTime: string, outTime: string): EditableFields => ({
    checkIn: inTime,
    checkOut: outTime,
    note,
  });

  function handleSignIn() {
    const value = checkIn || timeNow();
    void perform(async () => {
      await onSave(date, period, fields(value, checkOut));
      setCheckIn(value);
    });
  }

  function handleSignOut() {
    if (!record?.checkIn) {
      onToast('请先点击「签到」保存签到时间，再进行签退。', 'error');
      return;
    }
    const value = checkOut || timeNow();
    void perform(async () => {
      await onSave(date, period, fields(checkIn || record.checkIn || '', value));
      setCheckOut(value);
    });
  }

  function handleSaveChanges() {
    void perform(() => onSave(date, period, fields(checkIn, checkOut)));
  }

  function fillSuggested(which: 'in' | 'out') {
    if (which === 'in') {
      if (checkIn) return onToast('签到时间已有内容，推荐值没有覆盖它。', 'info');
      setCheckIn(info.inTime);
    } else {
      if (checkOut) return onToast('签退时间已有内容，推荐值没有覆盖它。', 'info');
      setCheckOut(info.outTime);
    }
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length === 0) return;
    void perform(() => onAddPhotos(date, period, selected));
  }

  function handleDeletePhoto(photoId: string) {
    if (!window.confirm('确定删除这张照片吗？此操作无法撤销。')) return;
    void perform(() => onDeletePhoto(date, period, photoId));
  }

  function handleClear() {
    if (!window.confirm(`确定清空 ${date} ${info.label}的打卡记录及照片吗？此操作无法撤销。`)) {
      return;
    }
    void perform(() => onClear(date, period));
  }

  return (
    <section className={`period-card period-${period}`} aria-label={`${date} ${info.label}`}>
      <div className="card-heading">
        <div className="period-name">
          <span className="period-icon" aria-hidden="true">{info.icon}</span>
          <span>{info.label}</span>
          <span className="period-date">{date.slice(5)}</span>
        </div>
        <span className={`status status-${status}`}>{statusLabel(status)}</span>
      </div>

      <div className="time-field">
        <label htmlFor={`in-${recordId}`}>签到时间</label>
        <div className="time-input-row">
          <input
            id={`in-${recordId}`}
            type="time"
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
            aria-label={`${date} ${info.label}签到时间`}
            disabled={working}
          />
          <button type="button" className="mini-button" onClick={() => setCheckIn(timeNow())} disabled={working}>
            现在
          </button>
          <button type="button" className="mini-button muted" onClick={() => fillSuggested('in')} disabled={working}>
            推荐
          </button>
        </div>
        <small>建议 {info.inTime}</small>
      </div>

      <div className="time-field">
        <label htmlFor={`out-${recordId}`}>签退时间</label>
        <div className="time-input-row">
          <input
            id={`out-${recordId}`}
            type="time"
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
            aria-label={`${date} ${info.label}签退时间`}
            disabled={working}
          />
          <button type="button" className="mini-button" onClick={() => setCheckOut(timeNow())} disabled={working}>
            现在
          </button>
          <button type="button" className="mini-button muted" onClick={() => fillSuggested('out')} disabled={working}>
            推荐
          </button>
        </div>
        <small>建议 {info.outTime}</small>
      </div>

      <label className="note-label" htmlFor={`note-${recordId}`}>备注（可选）</label>
      <textarea
        id={`note-${recordId}`}
        className="note-input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="记录今天的小收获…"
        disabled={working}
      />

      <div className="action-row">
        <button type="button" className="button primary" onClick={handleSignIn} disabled={working}>
          签到
        </button>
        <button type="button" className="button primary secondary" onClick={handleSignOut} disabled={working}>
          签退
        </button>
        <button type="button" className="button subtle" onClick={handleSaveChanges} disabled={working}>
          保存修改
        </button>
      </div>

      <div className="photo-section">
        <div className="photo-title">
          <span>照片 <span className="photo-count">{record?.photoIds.length ?? 0}</span></span>
          <div className="photo-buttons">
            <button type="button" className="link-button" onClick={() => albumRef.current?.click()} disabled={working}>
              ＋ 相册
            </button>
            <button type="button" className="link-button" onClick={() => cameraRef.current?.click()} disabled={working}>
              📷 拍照
            </button>
          </div>
        </div>
        <input ref={albumRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={handleUpload} />
        <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={handleUpload} />
        {photosLoading ? <p className="photo-empty">正在读取照片…</p> : photos.length > 0 ? (
          <div className="photo-grid">
            {photos.map((photo) => (
              <div className="photo-thumb" key={photo.id}>
                <a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label="预览照片">
                  <img src={photo.url} alt={`${info.label}打卡照片`} loading="lazy" />
                </a>
                <button
                  type="button"
                  className="delete-photo"
                  onClick={() => handleDeletePhoto(photo.id)}
                  disabled={working}
                  aria-label="删除这张照片"
                  title="删除照片"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : <p className="photo-empty">还没有照片，可选上传。</p>}
      </div>

      <div className="card-footer">
        <button type="button" className="clear-link" onClick={handleClear} disabled={working || !record}>
          清空本时段
        </button>
        {working && <span className="saving-indicator">保存中…</span>}
      </div>
    </section>
  );
}
