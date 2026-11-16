import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import PeriodCard from './components/PeriodCard';
import {
  clearEverything, clearPeriod, compressPhoto, getAllRecords,
  importIntoDatabase, putRecord, putRecordWithPhotos, removePhoto,
} from './db';
import { buildBackup, downloadBackup, parseBackup } from './backup';
import type {
  CheckinRecord, EditableFields, ImportMode, MessageKind, Period,
} from './types';
import { PERIODS } from './types';
import {
  addDays, beginningOfWeek, createRecord, dateKey, describeError,
  getRecordId, getStatus, todayKey, validateTimes, weekDates, weekTitle,
} from './utils';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface Toast {
  id: number;
  text: string;
  kind: MessageKind;
}

export default function App() {
  const [monday, setMonday] = useState(() => beginningOfWeek(new Date()));
  const [records, setRecords] = useState<Record<string, CheckinRecord>>({});
  const recordsRef = useRef(records);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [revision, setRevision] = useState(0);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [managing, setManaging] = useState(false);

  const notify = useCallback((text: string, kind: MessageKind = 'success') => {
    setToast({ id: Date.now() + Math.random(), text, kind });
  }, []);

  useEffect(() => {
    let active = true;
    getAllRecords()
      .then((items) => {
        if (!active) return;
        const mapped = Object.fromEntries(items.map((item) => [item.id, item]));
        recordsRef.current = mapped;
        setRecords(mapped);
      })
      .catch((error: unknown) => {
        if (active) setFatalError(describeError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function setRecordInMemory(record: CheckinRecord) {
    const next = { ...recordsRef.current, [record.id]: record };
    recordsRef.current = next;
    setRecords(next);
  }

  function deleteRecordInMemory(id: string) {
    const next = { ...recordsRef.current };
    delete next[id];
    recordsRef.current = next;
    setRecords(next);
  }

  async function handleSave(date: string, period: Period, fields: EditableFields) {
    const checkIn = fields.checkIn || null;
    const checkOut = fields.checkOut || null;
    const issue = validateTimes(checkIn, checkOut);
    if (issue) throw new Error(issue);
    const id = getRecordId(date, period);
    const previous = recordsRef.current[id] ?? createRecord(date, period);
    const record: CheckinRecord = {
      ...previous,
      checkIn,
      checkOut,
      note: fields.note.trim(),
      updatedAt: new Date().toISOString(),
    };
    await putRecord(record);
    setRecordInMemory(record);
    notify('已保存打卡记录。');
  }

  async function handleAddPhotos(date: string, period: Period, files: File[]) {
    if (files.length > 12) throw new Error('每次最多选择 12 张照片，请分批添加。');
    const id = getRecordId(date, period);
    const converted = [];
    for (const file of files) converted.push(await compressPhoto(file, id));
    const previous = recordsRef.current[id] ?? createRecord(date, period);
    const record: CheckinRecord = {
      ...previous,
      photoIds: [...previous.photoIds, ...converted.map((photo) => photo.id)],
      updatedAt: new Date().toISOString(),
    };
    await putRecordWithPhotos(record, converted);
    setRecordInMemory(record);
    notify(`已将 ${converted.length} 张照片保存在本机。`);
  }

  async function handleDeletePhoto(date: string, period: Period, photoId: string) {
    const id = getRecordId(date, period);
    const previous = recordsRef.current[id];
    if (!previous || !previous.photoIds.includes(photoId)) throw new Error('找不到这张照片。');
    const record: CheckinRecord = {
      ...previous,
      photoIds: previous.photoIds.filter((item) => item !== photoId),
      updatedAt: new Date().toISOString(),
    };
    await removePhoto(record, photoId);
    setRecordInMemory(record);
    notify('照片已删除。');
  }

  async function handleClearPeriod(date: string, period: Period) {
    const id = getRecordId(date, period);
    await clearPeriod(id);
    deleteRecordInMemory(id);
    notify('本时段记录已清空。');
  }

  async function handleExport() {
    setManaging(true);
    try {
      const backup = await buildBackup(includePhotos);
      downloadBackup(backup);
      notify(`已生成备份：${backup.records.length} 条记录${includePhotos ? '（含照片）' : '（不含照片）'}。`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setManaging(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setManaging(true);
    try {
      const backup = await parseBackup(file);
      const photoDescription = backup.photos === null
        ? '该备份不包含照片'
        : `包含 ${backup.photos.length} 张照片`;
      const modeDescription = importMode === 'replace'
        ? '覆盖导入：清空本机现有数据，再恢复备份。'
        : '合并导入：保留其他日期，重复日期及时段以备份为准。';
      const confirmed = window.confirm(
        `检测到 ${backup.records.length} 条记录，${photoDescription}。\n\n${modeDescription}\n\n确认继续吗？`,
      );
      if (!confirmed) return;

      await importIntoDatabase(backup, importMode);
      const restored = await getAllRecords();
      const mapped = Object.fromEntries(restored.map((record) => [record.id, record]));
      recordsRef.current = mapped;
      setRecords(mapped);
      setRevision((value) => value + 1);
      notify(`导入成功，当前共有 ${restored.length} 条记录。`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setManaging(false);
    }
  }

  async function handleClearAll() {
    if (!window.confirm('将删除本机所有打卡记录和照片。建议先导出备份。确定继续吗？')) {
      return;
    }
    if (!window.confirm('最后确认：删除后无法撤销，是否永久清空所有本地数据？')) {
      return;
    }
    setManaging(true);
    try {
      await clearEverything();
      recordsRef.current = {};
      setRecords({});
      setRevision((value) => value + 1);
      notify('所有本地数据已清空。');
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setManaging(false);
    }
  }

  const dates = weekDates(monday);
  const today = todayKey();
  const completed = dates.reduce((count, date) => count + PERIODS.filter(
    (period) => getStatus(records[getRecordId(dateKey(date), period)]) === 'completed',
  ).length, 0);
  const checkedIn = dates.reduce((count, date) => count + PERIODS.filter(
    (period) => getStatus(records[getRecordId(dateKey(date), period)]) === 'checked-in',
  ).length, 0);
  const isCurrentWeek = dateKey(monday) === dateKey(beginningOfWeek(new Date()));

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-inner">
          <div className="brand-mark" aria-hidden="true">✓</div>
          <div>
            <div className="brand-name">daily<span>-</span>checkin</div>
            <div className="brand-caption">一周一页，记录每一次认真生活</div>
          </div>
          <div className="header-pill">LOCAL FIRST · 无需登录</div>
        </div>
      </header>

      <main className="main-container">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">YOUR WEEKLY CHECK-IN</p>
            <h1>把每一天，<em>好好记录。</em></h1>
            <p>上午、下午、晚上，按自己的节奏签到、签退，让努力都有迹可循。</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span className="art-sun">✳</span>
            <span className="art-line">〰</span>
            <span className="art-check">✓</span>
          </div>
        </section>

        <section className="control-panel" aria-label="周视图导航和统计">
          <div className="week-picker">
            <p className="section-caption">本周计划 · WEEK OVERVIEW</p>
            <h2>{weekTitle(monday)}</h2>
            <div className="nav-buttons">
              <button type="button" className="nav-button" onClick={() => setMonday(addDays(monday, -7))}>← 上一周</button>
              <button type="button" className="nav-button" onClick={() => setMonday(beginningOfWeek(new Date()))} disabled={isCurrentWeek}>回到本周</button>
              <button type="button" className="nav-button" onClick={() => setMonday(addDays(monday, 7))}>下一周 →</button>
            </div>
          </div>
          <div className="stats">
            <div className="stat"><strong>{completed}<span>/21</span></strong><span>已完成</span></div>
            <div className="stat"><strong>{checkedIn}</strong><span>已签到</span></div>
            <div className="stat"><strong>{Math.round(completed / 21 * 100)}%</strong><span>周完成率</span></div>
            <div className="progress-track" aria-label={`本周完成率 ${Math.round(completed / 21 * 100)}%`}>
              <div className="progress-fill" style={{ width: `${completed / 21 * 100}%` }} />
            </div>
          </div>
        </section>

        <section className="data-panel" aria-label="数据备份和恢复">
          <div className="data-panel-intro">
            <strong>☁ 数据工具</strong>
            <p>所有记录与照片仅保存在当前设备的浏览器中，不会上传服务器。请定期备份。</p>
          </div>
          <div className="data-controls">
            <label className="checkbox-label">
              <input type="checkbox" checked={includePhotos} onChange={(event) => setIncludePhotos(event.target.checked)} disabled={managing} />
              导出时包含照片
            </label>
            <button className="button export-button" type="button" onClick={() => void handleExport()} disabled={managing || loading || !!fatalError}>
              ↓ 导出 JSON
            </button>
            <label className="import-mode-label">
              <span>导入方式</span>
              <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)} disabled={managing}>
                <option value="merge">合并</option>
                <option value="replace">覆盖</option>
              </select>
            </label>
            <label className={`button import-button ${managing ? 'is-disabled' : ''}`}>
              ↑ 导入 JSON
              <input type="file" accept=".json,application/json" onChange={(event) => void handleImport(event)} disabled={managing || loading || !!fatalError} />
            </label>
            <button className="button danger-button" type="button" onClick={() => void handleClearAll()} disabled={managing || loading || !!fatalError}>
              清空全部
            </button>
          </div>
        </section>

        {loading ? (
          <div className="system-state" role="status">
            <div className="loading-spinner" />
            <h3>正在读取本地记录…</h3>
            <p>数据只从当前浏览器的 IndexedDB 加载。</p>
          </div>
        ) : fatalError ? (
          <div className="system-state error-state" role="alert">
            <h3>无法读取本地数据</h3>
            <p>{fatalError}</p>
            <button type="button" className="button primary" onClick={() => window.location.reload()}>重试加载</button>
          </div>
        ) : (
          <>
            <div className="calendar-heading">
              <div>
                <h2>打卡日历</h2>
                <p>每个时段独立保存，照片可以不上传。</p>
              </div>
              <span className="calendar-legend"><i className="legend-completed" /> 已完成 <i className="legend-checked" /> 已签到 <i className="legend-empty" /> 未打卡</span>
            </div>
            <div className="week-grid">
              {dates.map((date, index) => {
                const key = dateKey(date);
                const isToday = key === today;
                return (
                  <article className={`day-column ${isToday ? 'is-today' : ''}`} key={key}>
                    <div className="day-heading">
                      <span className="weekday">{WEEKDAYS[index]}</span>
                      <strong>{date.getMonth() + 1}/{date.getDate()}</strong>
                      {isToday && <span className="today-badge">今天</span>}
                    </div>
                    <div className="day-cards">
                      {PERIODS.map((period) => (
                        <PeriodCard
                          key={getRecordId(key, period)}
                          date={key}
                          period={period}
                          record={records[getRecordId(key, period)]}
                          revision={revision}
                          onSave={handleSave}
                          onAddPhotos={handleAddPhotos}
                          onDeletePhoto={handleDeletePhoto}
                          onClear={handleClearPeriod}
                          onToast={notify}
                        />
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>daily-checkin © 2026 · MIT License</span>
        <span>为简单、私密、持续的记录而做 ♥</span>
      </footer>

      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>
          {toast.kind === 'error' ? '⚠ ' : toast.kind === 'success' ? '✓ ' : 'ℹ '}
          {toast.text}
        </div>
      )}
    </div>
  );
}
