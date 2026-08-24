import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const requestedDate = new URL(request.url).searchParams.get("date");

  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return NextResponse.json(
      { error: "Edition date must use YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase environment variables are missing" },
      { status: 500 }
    );
  }

  const query = requestedDate
    ? `status=eq.published&edition_date=eq.${requestedDate}&select=edition_date,payload&limit=1`
    : "status=eq.published&select=edition_date,payload&order=edition_date.desc&limit=1";

  const response = await fetch(
    `${supabaseUrl}/rest/v1/editions?${query}`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: "Could not load today’s edition" },
      { status: 502 }
    );
  }

  const rows = await response.json();

  if (!rows.length) {
    return NextResponse.json(
      { error: "Today’s edition is not published yet" },
      { status: 404 }
    );
  }

  const payload = rows[0].payload;
  const events = [];

  for (const scope of ["national", "international"]) {
    for (const category of ["politics", "sports", "business", "science", "entertainment", "tragedies"]) {
      for (const event of payload[scope]?.[category] || []) {
        const isEvent = Array.isArray(event.sources);
        events.push({
          id: event.event_id || `${scope}-${category}-${events.length + 1}`,
          summary: event.summary || event.short_summary || event.title || "Untitled event",
          microSummary: event.micro_summary || event.summary || event.short_summary || "",
          details: event.extended_summary || event.details || "",
          sources: isEvent ? event.sources : event.url ? [event.url] : [],
          facts: event.facts && typeof event.facts === "object" ? event.facts : {},
          importance: Number(event.importance) || 0,
          timestamp: event.timestamp || event.published || "",
          category,
          scope,
        });
      }
    }
  }

  return NextResponse.json({
    editionDate: rows[0].edition_date,
    events,
  });
}
