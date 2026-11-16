import type { CheckinRecord, CheckinStatus, Period } from './types';

export const PERIOD_INFO: Record<Period, {
  label: string;
  icon: string;
  inTime: string;
  outTime: string;
}> = {
  morning: { label: '上午', icon: '☀', inTime: '08:30', outTime: '12:00' },
  afternoon: { label: '下午', icon: '◒', inTime: '13:30', outTime: '18:00' },
  evening: { label: '晚上', icon: '☾', inTime: '19:30', outTime: '22:00' },
};

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function timeNow(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function beginningOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function weekTitle(monday: Date): string {
  const sunday = addDays(monday, 6);
  const first = `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日`;
  const last = monday.getFullYear() === sunday.getFullYear()
    ? `${sunday.getMonth() + 1}月${sunday.getDate()}日`
    : `${sunday.getFullYear()}年${sunday.getMonth() + 1}月${sunday.getDate()}日`;
  return `${first} — ${last}`;
}

export function getRecordId(date: string, period: Period): string {
  return `${date}__${period}`;
}

export function getStatus(record?: CheckinRecord): CheckinStatus {
  if (record?.checkIn && record.checkOut) return 'completed';
  if (record?.checkIn) return 'checked-in';
  return 'empty';
}

export function statusLabel(status: CheckinStatus): string {
  return { empty: '未打卡', 'checked-in': '已签到', completed: '已完成' }[status];
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateTimes(checkIn: string | null, checkOut: string | null): string | null {
  if (checkIn !== null && !isValidTime(checkIn)) return '签到时间格式无效，请使用 HH:mm。';
  if (checkOut !== null && !isValidTime(checkOut)) return '签退时间格式无效，请使用 HH:mm。';
  if (checkOut && !checkIn) return '请先签到，才能填写签退时间。';
  if (checkIn && checkOut && checkOut < checkIn) return '签退时间不能早于签到时间。';
  return null;
}

export function createRecord(date: string, period: Period): CheckinRecord {
  const now = new Date().toISOString();
  return {
    id: getRecordId(date, period),
    date,
    period,
    checkIn: null,
    checkOut: null,
    note: '',
    photoIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return '浏览器存储空间不足，请导出备份并清理部分照片。';
  }
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
