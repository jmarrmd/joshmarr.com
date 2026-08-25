/**
 * Live iCalendar feed for schoolnutritionandfitness.com WebMenus.
 *
 * Anchored on the MENU TYPE id, which is stable across school years, and
 * resolves each calendar month directly via menuType.menu(month, year).
 * Nothing is pinned to a particular month, so this does not expire.
 *
 * Served at:  https://www.joshmarr.com/lunch.ics
 * Options:    ?type=<menuTypeId>  menu type (defaults to DEFAULT_MENU_TYPE)
 *             ?name=<label>       calendar display name
 *             ?back=<n>           months of history to keep (0-6, default 1)
 *             ?ahead=<n>          months to look ahead (1-6, default 3)
 */

const GQL = "https://api.schoolnutritionandfitness.com/graphql";

// "Elementary Lunch Menu" — stable across school years.
const DEFAULT_MENU_TYPE = "58485a30eabc88213e8b4567";

const CATEGORY_ORDER = ["Entrees", "Sides", "Condiment", "Ancillary"];

// The API uses 0-indexed months (0 = January).
const monthQuery = (typeId, month, year) => `
{
  menuType(id: "${typeId}") {
    id
    name
    menu(month: ${month}, year: ${year}) {
      id month year
      items { day month year hidden product { id name category } }
    }
  }
}`;

async function gql(query) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "joshmarr-lunch-ics/2.0",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

/**
 * Resolve a window of months around today. Unpublished months come back
 * null and are simply skipped, so a gap (summer break) is not an error.
 */
async function fetchWindow(typeId, back, ahead) {
  const now = new Date();
  const targets = [];
  for (let offset = -back; offset <= ahead; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    targets.push({ month: d.getUTCMonth(), year: d.getUTCFullYear() });
  }

  // Resolved in parallel — each is an independent lookup.
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const data = await gql(monthQuery(typeId, t.month, t.year));
        return data?.menuType ?? null;
      } catch {
        return null; // one bad month must not sink the whole feed
      }
    })
  );

  const menus = [];
  let typeName = null;
  for (const mt of results) {
    if (!mt) continue;
    typeName ??= mt.name;
    if (mt.menu) menus.push(mt.menu);
  }
  return { menus, typeName };
}

/** Group visible items by calendar date. */
function daysFrom(menu) {
  const out = new Map();
  for (const item of menu.items ?? []) {
    if (item.hidden) continue;
    const name = (item.product?.name ?? "").trim();
    if (!name || !item.day) continue;

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
  return new Date(Date.UTC(y, m, d + 1)).toISOString().slice(0, 10).replace(/-/g, "");
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

  const seen = new Set();
  let count = 0;

  for (const menu of menus) {
    const days = [...daysFrom(menu).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [date, cats] of days) {
      if (seen.has(date)) continue; // guard against overlapping months
      seen.add(date);

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
        `UID:lunch-${date}@joshmarr.com`,
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

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};

export default async (req) => {
  const url = new URL(req.url);
  const typeId = url.searchParams.get("type") || DEFAULT_MENU_TYPE;
  const back = clamp(url.searchParams.get("back"), 0, 6, 1);
  const ahead = clamp(url.searchParams.get("ahead"), 1, 6, 3);

  if (!/^[a-f0-9]{24}$/i.test(typeId)) {
    return new Response("Invalid menu type id.\n", { status: 400 });
  }

  try {
    const { menus, typeName } = await fetchWindow(typeId, back, ahead);
    const calName = url.searchParams.get("name") || typeName || "School Lunch";
    const { ics, count } = buildIcs(menus, calName);

    // An empty calendar is valid (summer break) — still serve 200 so
    // subscribed clients don't drop the feed.
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="lunch.ics"',
        "Cache-Control": "public, max-age=3600",
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
