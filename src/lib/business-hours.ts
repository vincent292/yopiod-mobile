import type { BusinessHour } from "../types/domain";

export const DEFAULT_RESTAURANT_TIME_ZONE = "America/La_Paz";

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
  inputValue: string;
  minutesOfDay: number;
};

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function normalizeTime(value?: string | null) {
  return value ? value.slice(0, 5) : "";
}

function toMinutes(value?: string | null) {
  const normalized = normalizeTime(value);
  const [hour, minute] = normalized.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function datePartsToInput(parts: Pick<LocalDateTimeParts, "year" | "month" | "day" | "hour" | "minute">) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function getDayOfWeek(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function hasConfiguredHours(hours: BusinessHour[]) {
  return hours.some((hour) => !hour.isClosed && toMinutes(hour.opensAt) !== null && toMinutes(hour.closesAt) !== null);
}

function getZonedParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  return {
    day,
    dayOfWeek: getDayOfWeek(year, month, day),
    hour,
    inputValue: datePartsToInput({ day, hour, minute, month, year }),
    minute,
    minutesOfDay: hour * 60 + minute,
    month,
    year,
  };
}

function asMap(hours: BusinessHour[]) {
  return new Map(hours.map((hour) => [hour.dayOfWeek, hour]));
}

function isWithinRules(parts: LocalDateTimeParts, hours: BusinessHour[]) {
  if (!hasConfiguredHours(hours)) return true;

  const hoursByDay = asMap(hours);
  const current = hoursByDay.get(parts.dayOfWeek);
  const previous = hoursByDay.get((parts.dayOfWeek + 6) % 7);

  if (current && !current.isClosed) {
    const opensAt = toMinutes(current.opensAt);
    const closesAt = toMinutes(current.closesAt);
    if (opensAt !== null && closesAt !== null) {
      if (opensAt === closesAt) return true;
      if (opensAt < closesAt && parts.minutesOfDay >= opensAt && parts.minutesOfDay <= closesAt) return true;
      if (opensAt > closesAt && parts.minutesOfDay >= opensAt) return true;
    }
  }

  if (previous && !previous.isClosed) {
    const previousOpensAt = toMinutes(previous.opensAt);
    const previousClosesAt = toMinutes(previous.closesAt);
    if (previousOpensAt !== null && previousClosesAt !== null && previousOpensAt > previousClosesAt && parts.minutesOfDay <= previousClosesAt) {
      return true;
    }
  }

  return false;
}

function addDays(parts: LocalDateTimeParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    day: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

export function formatBusinessHour(hour?: BusinessHour | null) {
  if (!hour || hour.isClosed || !hour.opensAt || !hour.closesAt) return "Cerrado";
  return `${normalizeTime(hour.opensAt)} - ${normalizeTime(hour.closesAt)}`;
}

export function getBusinessStatus(hours: BusinessHour[], date = new Date(), timeZone = DEFAULT_RESTAURANT_TIME_ZONE) {
  const current = getZonedParts(date, timeZone);
  const hoursByDay = asMap(hours);
  const hasSchedule = hasConfiguredHours(hours);

  return {
    currentInputValue: current.inputValue,
    hasSchedule,
    isOpen: isWithinRules(current, hours),
    nextOpeningInputValue: getNextOpeningInputValue(hours, date, timeZone),
    todayHours: formatBusinessHour(hoursByDay.get(current.dayOfWeek)),
  };
}

export function getNextOpeningInputValue(hours: BusinessHour[], date = new Date(), timeZone = DEFAULT_RESTAURANT_TIME_ZONE) {
  const current = getZonedParts(date, timeZone);
  if (!hasConfiguredHours(hours)) return current.inputValue;

  const hoursByDay = asMap(hours);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidateDate = addDays(current, offset);
    const hour = hoursByDay.get(candidateDate.dayOfWeek);
    const opensAt = toMinutes(hour?.opensAt);
    if (!hour || hour.isClosed || opensAt === null) continue;

    const candidateInputValue = `${candidateDate.year}-${pad(candidateDate.month)}-${pad(candidateDate.day)}T${normalizeTime(hour.opensAt)}`;
    if (candidateInputValue > current.inputValue) return candidateInputValue;
  }

  return current.inputValue;
}

export function businessHoursSummary(hours: BusinessHour[]) {
  const labels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  const byDay = asMap(hours);
  return labels.map((label, index) => ({
    day: label,
    value: formatBusinessHour(byDay.get(index)),
  }));
}
