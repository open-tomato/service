/** The decorators: how one pino record line is drawn for its reader. */
import type { LogBreadcrumb } from '@open-tomato/service';

import process from 'node:process';

import { SCOPE_FIELD, STARTED_MESSAGE, TRACE_ID_FIELD } from '@open-tomato/service';

/**
 * Turns one pino record line into the text written for it.
 *
 * The line is pino's serialised record, a JSON object ending in a newline;
 * the text returned ends in a newline too.
 */
export type Decorator = (line: string) => string;

/** A parsed pino record: the breadcrumbs plus whatever else it carries. */
type LogRecord = LogBreadcrumb & Record<string, unknown>;

/** pino's own keys, never repeated as `key=value` fields. */
const PINO_KEYS: ReadonlySet<string> = new Set(['time', 'level', 'pid', 'hostname', 'msg']);

/** The keys drawn in a slot of their own rather than as fields. */
const SLOT_KEYS: ReadonlySet<string> = new Set(['service', TRACE_ID_FIELD, SCOPE_FIELD, 'err']);

/** How many characters of the trace id the line shows. */
const SHORT_TRACE_ID_LENGTH = 8;

/** The width the level word is padded to. */
const LEVEL_WIDTH = 5;

/** The most links of an error's `cause` chain drawn, so a cycle cannot loop. */
const MAX_CAUSE_DEPTH = 10;

/** What separates the slots of a line. */
const SLOT_SEPARATOR = '  ';

/** What a line of an error chain or a banner row is indented by. */
const INDENT = '  ';

/** The banner fields drawn first, in this order; any other field follows. */
const BANNER_ORDER: readonly string[] = ['version', 'transport', 'url', 'features', 'fallbackPort'];

const LEVEL_NAMES: Readonly<Record<number, string>> = {
  10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
};

const ANSI = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  magenta: '\u001B[35m',
  cyan: '\u001B[36m',
  gray: '\u001B[90m',
  bgRed: '\u001B[41m',
} as const;

type Style = keyof typeof ANSI;

const LEVEL_STYLE: Readonly<Record<string, Style>> = {
  trace: 'gray', debug: 'blue', info: 'green', warn: 'yellow', error: 'red', fatal: 'bgRed',
};

/** Wraps text in one ANSI style, or leaves it plain. */
type Paint = (style: Style, text: string) => string;

const plain: Paint = (_style, text) => text;
const coloured: Paint = (style, text) => `${ANSI[style]}${text}${ANSI.reset}`;

/** `NO_COLOR` set to any non-empty value turns colour off. */
function pickPaint(): Paint {
  const noColor = process.env['NO_COLOR'];
  return noColor !== undefined && noColor !== ''
    ? plain
    : coloured;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withNewline(text: string): string {
  return text.endsWith('\n')
    ? text
    : `${text}\n`;
}

function parseRecord(line: string): LogRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The record's time as local `HH:MM:SS.mmm`, or `undefined` when it has none. */
function formatTime(time: unknown): string | undefined {
  if (typeof time !== 'number' && typeof time !== 'string') return undefined;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return undefined;
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${millis}`;
}

function levelName(level: unknown): string {
  if (typeof level === 'number') return LEVEL_NAMES[level] ?? String(level);
  if (typeof level === 'string') return level;
  return 'info';
}

function formatLevel(level: unknown, paint: Paint): string {
  const name = levelName(level);
  const word = name.toUpperCase().padEnd(LEVEL_WIDTH);
  const style = LEVEL_STYLE[name];
  return style === undefined
    ? word
    : paint(style, word);
}

function stringSlot(value: unknown): string | undefined {
  return typeof value === 'string' && value !== ''
    ? value
    : undefined;
}

/** A field value as text: a bare word, a quoted string, or JSON. */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return /^[^\s="]+$/.test(value)
      ? value
      : JSON.stringify(value);
  }
  if (value === undefined) return 'undefined';
  return typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);
}

function isSlotted(record: LogRecord, key: string): boolean {
  if (key === 'err') return isRecord(record.err);
  return SLOT_KEYS.has(key) && stringSlot(record[key]) !== undefined;
}

/** The keys drawn as fields: neither pino's own nor one with a slot. */
function fieldKeys(record: LogRecord): string[] {
  return Object.keys(record).filter(key => !PINO_KEYS.has(key) && !isSlotted(record, key));
}

function formatFields(record: LogRecord, keys: readonly string[], paint: Paint): string[] {
  return keys.map(key => `${paint('dim', `${key}=`)}${formatValue(record[key])}`);
}

/** What separates the time, the level and the slots after them. */
const HEAD_SEPARATOR = ' ';

/** The service, short trace id, scope and message slots; a missing one is dropped. */
function bodySlots(record: LogRecord, paint: Paint): string[] {
  const service = stringSlot(record.service);
  const traceId = stringSlot(record[TRACE_ID_FIELD]);
  const scope = stringSlot(record[SCOPE_FIELD]);
  return [
    service === undefined
      ? undefined
      : paint('cyan', service),
    traceId === undefined
      ? undefined
      : paint('gray', traceId.slice(0, SHORT_TRACE_ID_LENGTH)),
    scope === undefined
      ? undefined
      : paint('magenta', scope),
    stringSlot(record.msg),
  ].filter((slot): slot is string => slot !== undefined);
}

/**
 * The time and the padded level, each followed by one space, then the other
 * slots two spaces apart: `12:04:31.250 INFO  orders  user created`.
 */
function joinLine(record: LogRecord, slots: readonly string[], paint: Paint): string {
  const time = formatTime(record.time);
  const head = [
    ...(time === undefined
      ? []
      : [paint('dim', time)]),
    formatLevel(record.level, paint),
  ];
  return [...head, slots.join(SLOT_SEPARATOR)]
    .filter(part => part !== '')
    .join(HEAD_SEPARATOR);
}

/** One `<type>: <message>` line per link of the serialised error and its `cause` chain. */
function errorLines(err: unknown, paint: Paint): string[] {
  const lines: string[] = [];
  let link: unknown = err;
  while (isRecord(link) && lines.length < MAX_CAUSE_DEPTH) {
    const type = stringSlot(link.type) ?? stringSlot(link.name) ?? 'Error';
    const message = typeof link.message === 'string'
      ? link.message
      : '';
    lines.push(`${INDENT}${paint('red', `${type}: ${message}`)}`);
    link = link.cause;
  }
  return lines;
}

function isBanner(record: LogRecord): boolean {
  return record.msg === STARTED_MESSAGE && typeof record.url === 'string';
}

function formatFeatures(features: unknown): string {
  if (!isRecord(features)) return formatValue(features);
  const entries = Object.entries(features);
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(SLOT_SEPARATOR);
}

function formatBannerValue(key: string, value: unknown): string {
  if (key === 'features') return formatFeatures(value);
  if (key === 'fallbackPort') return `${formatValue(value)} (taken)`;
  return typeof value === 'string'
    ? value
    : formatValue(value);
}

/** The `started` record as a head line and one `<label> <value>` row per field. */
function drawBanner(record: LogRecord, paint: Paint): string {
  const keys = fieldKeys(record);
  const ordered = [
    ...BANNER_ORDER.filter(key => keys.includes(key)),
    ...keys.filter(key => !BANNER_ORDER.includes(key)),
  ];
  const width = Math.max(...ordered.map(key => key.length));
  const rows = ordered.map((key) => {
    const label = paint('dim', key.padEnd(width));
    return `${INDENT}${label}${SLOT_SEPARATOR}${formatBannerValue(key, record[key])}`;
  });
  const head = joinLine(record, bodySlots(record, paint), paint);
  return [head, ...rows, ...errorLines(record.err, paint)].join('\n');
}

function drawLine(record: LogRecord, paint: Paint): string {
  const slots = [...bodySlots(record, paint), ...formatFields(record, fieldKeys(record), paint)];
  return [joinLine(record, slots, paint), ...errorLines(record.err, paint)].join('\n');
}

/**
 * Returns pino's line unchanged, for a reader that is a program.
 *
 * @param line - One pino record line.
 * @returns The same line.
 */
export const json: Decorator = line => line;

/**
 * Draws one pino record line for a person at a terminal.
 *
 * The line reads time, level, service, the first 8 characters of the trace
 * id, scope, message, then the other fields as `key=value`; a missing slot
 * is dropped. The serialised `err` and each link of its `cause` chain follow
 * as one `<type>: <message>` line each, and a `started` record is drawn as a
 * short block. Colour is off when `NO_COLOR` is set to a non-empty value.
 *
 * @param line - One pino record line.
 * @returns The drawn text ending in a newline, or the line itself when it is
 * not a JSON object.
 */
export const terminal: Decorator = (line) => {
  const record = parseRecord(line);
  if (record === undefined) return withNewline(line);
  const paint = pickPaint();
  const text = isBanner(record)
    ? drawBanner(record, paint)
    : drawLine(record, paint);
  return withNewline(text);
};
