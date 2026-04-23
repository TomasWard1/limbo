/**
 * get_current_time — MCP tool returning the current timestamp in the user's
 * timezone. The container's TZ env var is set from USER_TIMEZONE by entrypoint.sh,
 * so Date() and Intl operate in that zone by default.
 *
 * Returns { iso, isoUtc, timezone, unix, weekday } so the agent can plug the
 * value directly into cron_add / calendar_create without hallucinating.
 */

export async function getCurrentTime() {
  const now = new Date();
  const timezone = process.env.TZ || "UTC";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(now);

  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const offsetRaw = p.timeZoneName || "GMT+00:00";
  const offsetMatch = offsetRaw.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offset = offsetMatch
    ? `${offsetMatch[1].padStart(3, "+0").replace("+0-", "-0")}:${offsetMatch[2] || "00"}`
    : "+00:00";
  const hourNorm = p.hour === "24" ? "00" : p.hour;
  const iso = `${p.year}-${p.month}-${p.day}T${hourNorm}:${p.minute}:${p.second}${offset}`;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            iso,
            isoUtc: now.toISOString(),
            timezone,
            unix: Math.floor(now.getTime() / 1000),
            weekday,
          },
          null,
          2
        ),
      },
    ],
  };
}
