import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function cleanText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Article URL is required" }, { status: 400 });
  }

  let articleUrl: URL;

  try {
    articleUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid article URL" }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(articleUrl.protocol)) {
    return NextResponse.json({ error: "Invalid article protocol" }, { status: 400 });
  }

  try {
    const response = await fetch(articleUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 Minimum Times/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Article request failed (${response.status})`);
    }

    const html = await response.text();
    const document = new JSDOM(html, { url: response.url }).window.document;
    const parsed = new Readability(document).parse();

    if (!parsed?.textContent) {
      throw new Error("Article content could not be extracted");
    }

    return NextResponse.json({
      title: parsed.title || "Article details",
      text: cleanText(parsed.textContent),
      url: response.url || url,
    });
  } catch (error) {
    console.error("ARTICLE DETAILS ERROR:", error);

    return NextResponse.json(
      {
        error: "More information could not be loaded. Open the original article below.",
        url,
      },
      { status: 502 }
    );
  }
}
