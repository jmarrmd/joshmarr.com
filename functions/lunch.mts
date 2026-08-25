/**
 * Live iCalendar feed for schoolnutritionandfitness.com WebMenus.
 *
 * The vendor has no iCal export, but its public GraphQL API returns
 * structured per-day menu items. This walks the published-month chain
 * and emits one all-day event per school day.
 *
 * Served at:  https://www.joshmarr.com/lunch.ics
 * Options:    ?id=<menuId>   start menu (defaults to DEFAULT_MENU_ID)
 *             ?name=<label>  calendar display name
 *             ?months=<n>    how many months forward to walk (1-12)
 */

const GQL = "https://api.schoolnutritionandfitness.com/graphql";

// Elementary Lunch Menu, siteCode 3397
const DEFAULT_MENU_ID = "6a7e1eebb7679f386e68a398";

const CATEGORY_ORDER = ["Entrees", "Sides", "Condiment", "Ancillary"];

const QUERY = (id) => `
{
  menu(id: "${id}") {
    id month year
    menuType { id name }
    items { day month year hidden product { id name category } }
    nextMonthPublished { id }
  }
}`;

async function fetchMenu(id) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "joshmarr-lunch-ics/1.0",
    },
    body: JSON.stringify({ query: QUERY(id) }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.data?.menu ?? null;
}

/** Follow nextMonthPublished so the feed keeps rolling into new months. */
async function fetchChain(startId, maxMonths) {
  const menus = [];
  const seen = new Set();
  let id = startId;
  while (id && !seen.has(id) && menus.length < maxMonths) {
    const menu = await fetchMenu(id);
    if (!menu) break;
    seen.add(menu.id);
    menus.push(menu);
    id = menu.nextMonthPublished?.id ?? null;
  }
  return menus;
}

/** Group visible items into { "YYYYMMDD": { category: [names] } }. */
function daysFrom(menu) {
  const out = new Map();
  for (const item of menu.items ?? []) {
    if (item.hidden) continue;
    const name = (item.product?.name ?? "").trim();
    if (!name || !item.day) continue;

    // API months are 0-indexed; item values override the menu's.
    const mo = item.month ?? menu.month;
    const yr = item.year ?? menu.year;
    const d = new Date(Date.UTC(yr, mo, item.day));
    if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(item.day)) continue;

    const key = d.toISOString().slice(0, 10).replace(/-/g, "");
    const cat = item.product?.category || "Other";
    if (!out.has(key)) out.set(key, new Map());
    const cats = out.get(key);
    if (!cats.has(cat)) cats.set(cat, []);
    cats.get(cat).push(name);
  }
  return out;
}

const escText = (t) =>
  t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** RFC 5545: content lines must be <=75 octets, continued with a leading space. */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  while (i < bytes.length) {
    const take = parts.length === 0 ? 75 : 74;
    let chunk = bytes.subarray(i, i + take);
    // never split a multi-byte character
    while (chunk.length && (chunk[chunk.length - 1] & 0xc0) === 0x80) {
      chunk = chunk.subarray(0, chunk.length - 1);
    }
    parts.push(chunk.toString("utf8"));
    i += chunk.length;
  }
  return parts.join("\r\n ");
}

const nextDay = (yyyymmdd) => {
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6) - 1;
  const d = +yyyymmdd.slice(6, 8);
  const t = new Date(Date.UTC(y, m, d + 1));
  return t.toISOString().slice(0, 10).replace(/-/g, "");
};

function buildIcs(menus, calName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//joshmarr.com//school lunch feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${escText(calName)}`),
    "X-PUBLISHED-TTL:PT12H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
  ];

  let count = 0;
  for (const menu of menus) {
    const days = [...daysFrom(menu).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [date, cats] of days) {
      const entrees = cats.get("Entrees") ?? [];
      let title = entrees.length
        ? entrees.join(" / ")
        : [...cats.values()].flat().join(", ");
      if (title.length > 70) title = title.slice(0, 67).replace(/[,\s]+$/, "") + "...";

      const ordered = [
        ...CATEGORY_ORDER.filter((c) => cats.has(c)),
        ...[...cats.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
      ];
      const body = ordered.map((c) => `${c}: ${cats.get(c).join(", ")}`).join("\n");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${menu.id}-${date}@joshmarr.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${date}`,
        `DTEND;VALUE=DATE:${nextDay(date)}`,
        fold(`SUMMARY:${escText(title)}`),
        fold(`DESCRIPTION:${escText(body)}`),
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
      count++;
    }
  }

  lines.push("END:VCALENDAR");
  return { ics: lines.join("\r\n") + "\r\n", count };
}

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || DEFAULT_MENU_ID;
  const months = Math.min(Math.max(Number(url.searchParams.get("months")) || 12, 1), 12);

  if (!/^[a-f0-9]{24}$/i.test(id)) {
    return new Response("Invalid menu id.\n", { status: 400 });
  }

  try {
    const menus = await fetchChain(id, months);
    if (!menus.length) return new Response("Menu not found.\n", { status: 404 });

    const calName =
      url.searchParams.get("name") || menus[0].menuType?.name || "School Lunch";
    const { ics, count } = buildIcs(menus, calName);

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="lunch.ics"',
        // Browser/client cache
        "Cache-Control": "public, max-age=3600",
        // Netlify CDN: serve fast, refresh in the background
        "Netlify-CDN-Cache-Control":
          "public, durable, max-age=21600, stale-while-revalidate=86400",
        "X-Menu-Days": String(count),
        "X-Menu-Months": String(menus.length),
      },
    });
  } catch (err) {
    return new Response(`Upstream error: ${err.message}\n`, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
};

export const config = { path: "/lunch.ics" };
