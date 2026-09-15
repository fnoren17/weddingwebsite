/**
 * The schedule's pure logic — which events a guest may see, and what order they
 * run in.
 *
 * Separate from `config.ts` because that module reads the filesystem, and the
 * admin editor is a client component: importing the type from there would drag
 * `fs` into the browser bundle. Nothing here touches the network, the DOM or the
 * disk. Covered by `npm run check:schedule`.
 */

export interface ScheduleEvent {
    time: string;
    title: string;
    description: string;
    location: string;
    /**
     * Shown on the public schedule page.
     *
     * Optional, and absent means **public** — every event written before this
     * field existed was on the public page, and reading a missing flag as
     * "private" would blank a live schedule the moment this shipped.
     */
    public?: boolean;
}

/** Whether a guest may see this event. */
export function isPublicEvent(event: Pick<ScheduleEvent, 'public'>): boolean {
    return event.public !== false;
}

/** The events a guest may see, in the order the admin put them. */
export function publicScheduleEvents(events: ScheduleEvent[] | undefined): ScheduleEvent[] {
    return (events ?? []).filter(isPublicEvent);
}

interface ParsedEventTime {
    minutes: number;
    /** Whether the person wrote am/pm (or `noon`/`midnight`) themselves. */
    meridiem: boolean;
}

/**
 * Minutes past midnight for a time as a person types it, or null, along with
 * whether they wrote it in 12-hour (am/pm) or 24-hour notation.
 *
 * Deliberately forgiving about the shapes that turn up in a run-of-show —
 * `4:00 PM`, `4pm`, `16:00`, `1230`, `830am`, `9.30am`, `noon` — and
 * deliberately unwilling to guess: anything it does not recognise answers null
 * and keeps its place rather than being sorted somewhere arbitrary.
 *
 * Anchored at both ends on purpose. Matching a prefix is how `1230` used to read
 * as twelve o'clock: the hour matched, the minutes were left on the floor, and
 * nothing said so.
 */
function parseEventTimeDetailed(time: string): ParsedEventTime | null {
    const text = (time ?? '').trim().toLowerCase();
    if (!text) return null;
    if (/^(noon|midday)$/.test(text)) return { minutes: 12 * 60, meridiem: true };
    if (/^midnight$/.test(text)) return { minutes: 0, meridiem: true };

    const match = text.match(/^(\d{1,4})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
    if (!match) return null;

    const digits = match[1];
    let hour: number;
    let minute: number;

    if (match[2] !== undefined) {
        // A separator says which half is which, so the hour cannot be four digits.
        if (digits.length > 2) return null;
        hour = Number(digits);
        minute = Number(match[2]);
    } else if (digits.length <= 2) {
        // `8`, `16` — an hour on its own.
        hour = Number(digits);
        minute = 0;
    } else {
        // `830`, `1230`, `0800` — the last two digits are always the minutes.
        hour = Number(digits.slice(0, -2));
        minute = Number(digits.slice(-2));
    }
    if (minute > 59) return null;

    const meridiemText = (match[3] ?? '').replace(/\./g, '');
    const meridiem = meridiemText === 'am' || meridiemText === 'pm';
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        if (hour === 12) hour = 0;
        if (meridiemText === 'pm') hour += 12;
    } else if (hour > 23) {
        return null;
    }
    return { minutes: hour * 60 + minute, meridiem };
}

/**
 * Minutes past midnight for a time as a person types it, or null.
 *
 * See `parseEventTimeDetailed` for the shapes this accepts.
 */
export function parseEventTime(time: string): number | null {
    return parseEventTimeDetailed(time)?.minutes ?? null;
}

/**
 * Minutes past midnight, written the way the schedule shows them.
 *
 * `use24Hour` picks `16:00` over `4:00 PM` — the schedule keeps whichever
 * notation the person typed rather than forcing every row onto one clock, so
 * `17.00` stays a 24-hour time instead of becoming `5:00 PM`.
 */
export function formatEventTime(minutes: number, use24Hour = false): string {
    const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(wrapped / 60);
    const minute = wrapped % 60;
    if (use24Hour) {
        return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Tidy a time as it was typed into the one the schedule keeps.
 *
 * `8am` becomes `8:00 AM`; `17.00` becomes `17:00` — each row keeps the
 * 12-hour/24-hour notation it was written in rather than every row being
 * forced onto one clock, so a 24-hour time is never silently rewritten as
 * am/pm. Anything the parser does not recognise is handed back trimmed and
 * otherwise untouched — "after the toasts" is a real answer for a row, and
 * rewriting it would be worse than leaving it alone.
 */
export function normalizeEventTime(time: string): string {
    const parsed = parseEventTimeDetailed(time);
    return parsed === null ? (time ?? '').trim() : formatEventTime(parsed.minutes, !parsed.meridiem);
}

/**
 * The day in clock order.
 *
 * The order *is* the times — there is no separate hand-ordering to preserve, so
 * moving something means changing when it happens. Rows whose time cannot be
 * read (blank, "TBD", "after the toasts") collect at the end in the order they
 * were already in, which is also where a freshly added blank row belongs: at
 * the bottom, until it is given a time and takes its place.
 */
export function sortByTime(events: ScheduleEvent[]): ScheduleEvent[] {
    const timed: { event: ScheduleEvent; at: number; index: number }[] = [];
    const untimed: { event: ScheduleEvent; index: number }[] = [];

    events.forEach((event, index) => {
        const at = parseEventTime(event.time);
        if (at === null) untimed.push({ event, index });
        else timed.push({ event, at, index });
    });

    // Ties keep the order they were in, so re-sorting a sorted day changes
    // nothing and two things at 4:00 PM do not swap on every keystroke.
    timed.sort((a, b) => a.at - b.at || a.index - b.index);
    return [...timed.map(t => t.event), ...untimed.map(u => u.event)];
}

/**
 * A blank row, with every field the editor writes.
 *
 * Private until ticked. Most of what goes into a run-of-show — call times,
 * setup, breakdown — is not for guests, and the safe default for a page that
 * publishes is the one where forgetting to think about it shows nobody
 * anything. Note this is an explicit `false`, not an absent flag: absent still
 * means public, which is what keeps events written before the tick existed on
 * the page.
 */
export function blankEvent(): ScheduleEvent {
    return { time: '', title: '', description: '', location: '', public: false };
}

/* ---------------------------------------------------------------------------
   Export
   --------------------------------------------------------------------------- */

/**
 * The spreadsheet's columns.
 *
 * `Public` is one of them rather than the export being split in two: the file
 * is the whole run of the day, and a coordinator who only wants the guest-facing
 * rows filters the column. Leaving it out would produce a file nobody could tell
 * apart from a guest-facing one.
 */
export const SCHEDULE_HEADERS = ['Time', 'Event', 'Location', 'Description', 'Public'] as const;

/** The day as rows, in the order it is shown — which is clock order. */
export function scheduleRows(events: ScheduleEvent[]): string[][] {
    return events.map(event => [
        event.time ?? '',
        event.title ?? '',
        event.location ?? '',
        event.description ?? '',
        isPublicEvent(event) ? 'Yes' : 'No',
    ]);
}
