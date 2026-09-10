import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");

const parser = new Parser();
const googleDecoder = new GoogleDecoder();
const jsdomVirtualConsole = new VirtualConsole();
jsdomVirtualConsole.on("jsdomError", () => {});
const categories = ["politics", "sports", "business", "science", "entertainment", "tragedies"];
const scopes = ["national", "international"];
const maxPerCategory = 4;
const feedAttempts = 2;
const FEED_TIMEOUT_MS = 30000;
const FEED_CONCURRENCY = 3;
const EVENT_PUBLISH_THRESHOLD = 0.5;
const PREVIOUS_EVENT_SIMILARITY_THRESHOLD = 0.8;
const PREVIOUS_EVENT_COMPARISON_CONCURRENCY = 3;
const MIN_SHORT_VALID_WORDS = 40;
const MIN_FULL_EXTRACTION_WORDS = 120;
const GOOGLE_RESOLUTION_TIMEOUT_MS = 15000;
const MAX_ITEMS_PER_FEED = 20;
const extractionMetrics = {
  full_extraction: 0,
  short_but_valid: 0,
  blocked: 0,
  empty: 0,
  rss_only: 0,
};
const categoryGuidance = {
  politics: "government, elections, courts, public policy, diplomacy, or major political developments. Require a concrete decision, ruling, law, policy, official action, election result, or consequential development; discard reactions without a substantive development.",
  sports: "sporting competitions, teams, athletes, scores, transfers, or governing bodies. If the story concerns a game, the summaries MUST include the exact score or current scoreboard when it appears in the text, including both teams' scores and match status; never use vague wording when a score is available.",
  business: "major companies, markets, jobs, inflation, budgets, trade, investment, or economic policy. Keep concrete decisions, results, filings, regulatory actions, major deals, or meaningful economic changes; discard market noise, predictions, promotions, and routine corporate announcements.",
  science: "important science and technology developments, including research, space, cybersecurity, artificial intelligence, and major technology policy. Keep verified discoveries, launches, breaches, regulations, or consequential technical developments; discard product promotion, speculation, and minor updates.",
  entertainment: "film, television, music, theatre, books, or notable entertainment-industry developments. Keep verified releases, cancellations, premieres, earnings, awards, casting, or official announcements; discard promotional claims, predictions, rumours, and vague box-office wording.",
  tragedies: "significant deaths, disasters, crashes, fires, explosions, floods, earthquakes, wars, or emergencies. State the event, location, scale, and confirmed deaths, injuries, displacement, affected population, damage, or official response; merge repetitive updates about the same event.",
};

const feeds = {
  national: {
    politics: "https://news.google.com/rss/search?q=India+(government+OR+parliament+OR+election+OR+minister+OR+court)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    sports: "https://news.google.com/rss/search?q=India+(sports+OR+cricket+OR+football)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    business: "https://news.google.com/rss/search?q=India+(business+OR+economy+OR+market+OR+company+OR+inflation+OR+budget)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    science: "https://news.google.com/rss/search?q=India+(science+OR+technology+OR+AI+OR+space+OR+cybersecurity)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    entertainment: "https://news.google.com/rss/search?q=India+(actor+OR+film+OR+music+OR+entertainment)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    tragedies: "https://news.google.com/rss/search?q=India+(earthquake+OR+accident+OR+fire+OR+explosion+OR+flood+OR+crash)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
  },
  international: {
    politics: "https://news.google.com/rss/search?q=(government+OR+parliament+OR+election+OR+president+OR+court)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    sports: "https://news.google.com/rss/search?q=(sports+OR+football+OR+tennis+OR+Olympics)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    business: "https://news.google.com/rss/search?q=(business+OR+economy+OR+market+OR+company+OR+inflation)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    science: "https://news.google.com/rss/search?q=(science+OR+technology+OR+AI+OR+space+OR+cybersecurity)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    entertainment: "https://news.google.com/rss/search?q=(actor+OR+film+OR+music+OR+entertainment)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    tragedies: "https://news.google.com/rss/search?q=(earthquake+OR+accident+OR+fire+OR+explosion+OR+flood+OR+crash)+-India+when:1d&hl=en&gl=US&ceid=US:en",
  },
};

const required = ["NVIDIA_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is missing`);
}

function logPipeline(event, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  }));
}

const normalize = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const meaningfulWords = (value) => new Set(
  normalize(value)
    .split(" ")
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from", "that", "this"].includes(word))
);

function sameStory(left, right) {
  if (left.url && right.url && left.url === right.url) return true;
  const leftWords = meaningfulWords(left.title || "");
  const rightWords = meaningfulWords(right.title || "");
  if (!leftWords.size || !rightWords.size) return false;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap >= 5 && overlap / Math.min(leftWords.size, rightWords.size) >= 0.75;
}

function deduplicateLocally(items) {
  const unique = [];
  const duplicates = [];
  for (const item of items) {
    const existing = unique.find((candidate) => sameStory(candidate, item));
    if (existing) {
      duplicates.push({ duplicate: item, kept: existing });
    } else {
      unique.push(item);
    }
  }
  return { unique, duplicates };
}

function limitWords(value, maxWords) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

function normalizeImportance(value) {
  return Math.max(1, Math.min(10, Math.round(Number(value) * 10) || 1));
}

function normalizeRating(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function isGoogleNewsUrl(url) {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}

async function resolvePublisherUrl(url) {
  if (!isGoogleNewsUrl(url)) return { url, status: "direct" };
  try {
    const result = await Promise.race([
      googleDecoder.decode(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("google_url_resolution_timeout")), GOOGLE_RESOLUTION_TIMEOUT_MS)),
    ]);
    if (result.status && result.decoded_url) {
      logPipeline("google_url_resolved", { wrapper_url: url, publisher_url: result.decoded_url });
      return { url: result.decoded_url, status: "resolved" };
    }
    logPipeline("google_url_resolution_failed", { wrapper_url: url, reason: result.message || "unknown" });
  } catch (error) {
    logPipeline("google_url_resolution_failed", {
      wrapper_url: url,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return { url, status: "unresolved" };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 6000);
}

function isBlockedOrBoilerplate(text) {
  const normalized = text.toLowerCase();
  return [
    "enable javascript",
    "access denied",
    "automated access",
    "verify you are human",
    "subscribe to continue",
    "sign in to continue",
    "page not found",
    "robot check",
  ].some((marker) => normalized.includes(marker));
}

function jsonLdArticleBodies(document) {
  const bodies = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || "");
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value?.articleBody) bodies.push(value.articleBody);
        if (Array.isArray(value?.["@graph"])) {
          bodies.push(...value["@graph"].filter((item) => item?.articleBody).map((item) => item.articleBody));
        }
      }
    } catch {
      // Ignore malformed metadata and continue with HTML extraction.
    }
  }
  return bodies;
}

async function articleText(url, sourceTier) {
  const resolved = await resolvePublisherUrl(url);
  if (resolved.status === "unresolved") {
    return { text: "", status: "rss_only", resolvedUrl: url, reason: "google_url_unresolved" };
  }

  try {
    const response = await fetch(resolved.url, {
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 Minimum Times/1.0",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8",
      },
    });
    if (!response.ok) {
      return { text: "", status: "blocked", resolvedUrl: resolved.url, reason: `http_${response.status}` };
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("json") && !contentType.includes("text")) {
      return { text: "", status: "empty", resolvedUrl: resolved.url, reason: `unsupported_content_type:${contentType}` };
    }

    const body = await response.text();
    const document = new JSDOM(body, {
      url: response.url || resolved.url,
      virtualConsole: jsdomVirtualConsole,
    }).window.document;
    const parsed = new Readability(document).parse();
    const candidates = [
      ...jsonLdArticleBodies(document),
      document.querySelector("article")?.textContent,
      parsed?.textContent,
    ].map(cleanText).filter(Boolean);
    const text = candidates.sort((left, right) => right.length - left.length)[0] || "";
    const words = text.split(/\s+/).filter(Boolean).length;

    if (!text || isBlockedOrBoilerplate(text)) {
      return { text: "", status: "blocked", resolvedUrl: response.url || resolved.url, reason: "boilerplate_or_interstitial" };
    }
    if (words < MIN_SHORT_VALID_WORDS) {
      return { text: "", status: "empty", resolvedUrl: response.url || resolved.url, reason: "insufficient_article_text" };
    }
    return {
      text,
      status: words >= MIN_FULL_EXTRACTION_WORDS ? "full_extraction" : "short_but_valid",
      resolvedUrl: response.url || resolved.url,
      sourceTier,
    };
  } catch (error) {
    return {
      text: "",
      status: "blocked",
      resolvedUrl: resolved.url,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchFeed({ scope, category, url, sourceName, sourceTier }) {
  let lastError;

  for (let attempt = 1; attempt <= feedAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers: { Accept: "application/rss+xml, application/xml, text/xml;q=0.9" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await parser.parseString(await response.text());
      const items = feed.items.slice(0, MAX_ITEMS_PER_FEED);
      if (items.length === 0) throw new Error("empty feed");

      return Promise.all(items.map(async (item, index) => {
        const story = {
          scope,
          category,
          sourceName,
          sourceTier,
          title: item.title || "Untitled story",
          url: item.link || "https://news.google.com/",
          published: item.pubDate || "",
          text: item.contentSnippet || item.content || "",
        };
        logPipeline("story_fetched", {
          scope,
          category,
          feed_index: index,
          title: story.title,
          url: story.url,
          published: story.published,
          source_name: story.sourceName,
          source_tier: story.sourceTier,
          feed_text_length: story.text.length,
        });
        return story;
      }));
    } catch (error) {
      lastError = error;
      if (attempt < feedAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw new Error(`Feed failed after ${feedAttempts} attempts: ${scope}/${category} (${lastError?.message || "unknown error"})`);
}

async function runFeedTasks(tasks) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      try {
        results[index] = { status: "fulfilled", value: await fetchFeed(task) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(FEED_CONCURRENCY, tasks.length) },
      () => worker(),
    ),
  );
  return results;
}

async function loadPreviousEditions(date) {
  const endpoint = `${process.env.SUPABASE_URL}/rest/v1/editions?status=eq.published&edition_date=lt.${date}&select=edition_date,payload&order=edition_date.desc&limit=2`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
    const rows = await response.json();
    return rows.flatMap((row) =>
      scopes.flatMap((scope) =>
        categories.flatMap((category) =>
          (row.payload?.[scope]?.[category] || []).map((event) => ({
            editionDate: row.edition_date,
            scope,
            category,
            summary: event.summary || event.short_summary || event.title || "",
            facts: event.facts && typeof event.facts === "object" ? event.facts : {},
            sources: Array.isArray(event.sources) ? event.sources : [],
          }))
        )
      )
    );
  } catch (error) {
    console.warn(`Previous edition unavailable: ${error.message}`);
    return [];
  }
}

async function askNemotron(prompt, maxTokens, responseType = "array") {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(55000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b",
        temperature: 1,
        top_p: 0.95,
        max_tokens: maxTokens,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    logPipeline("nvidia_request_failed", {
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    logPipeline("nvidia_request_failed", {
      status: response.status,
      duration_ms: Date.now() - startedAt,
      response_preview: body,
    });
    throw new Error(`NVIDIA request failed (${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    logPipeline("nvidia_invalid_response", {
      duration_ms: Date.now() - startedAt,
      response_keys: Object.keys(data || {}),
    });
    throw new Error("NVIDIA response did not contain message content");
  }

  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
  } catch (error) {
    logPipeline("nvidia_invalid_json", {
      duration_ms: Date.now() - startedAt,
      response_preview: content.slice(0, 1000),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  logPipeline("nvidia_request_succeeded", {
    duration_ms: Date.now() - startedAt,
    response_type: responseType,
  });
  if (responseType === "object") return parsed;
  return Array.isArray(parsed) ? parsed : parsed.decisions || [];
}

async function groupEventsWithNemotron(items) {
  const prompt = `You are a news event editor. Group supplied reports that describe the same real-world event. Different publishers reporting the same match, decision, accident, release, or other event belong in one group. Keep distinct events separate. Every supplied index must appear exactly once in one group. Return ONLY valid JSON.

Return this shape:
{"events":[{"indices":[0,1],"importance":9}]}

Importance must be an integer from 1 to 10. ARTICLES:\n\n${items.map((item, index) => {
    return `INDEX: ${index}\nHEADLINE: ${item.title}\nARTICLE TEXT: ${item.text}\nURL: ${item.url}`;
  }).join("\n\n")}`;

  const response = await askNemotron(prompt, 2500, "object");
  const rawGroups = Array.isArray(response?.events) ? response.events : [];
  const assigned = new Set();
  const groups = [];

  for (const group of rawGroups) {
    const indices = Array.isArray(group.indices)
      ? [...new Set(group.indices.filter((index) => Number.isInteger(index) && index >= 0 && index < items.length && !assigned.has(index)))]
      : [];
    if (!indices.length) continue;
    indices.forEach((index) => assigned.add(index));
    groups.push({
      indices,
      importance: Math.max(1, Math.min(10, Math.round(Number(group.importance) || 1))),
    });
  }

  items.forEach((_item, index) => {
    if (!assigned.has(index)) groups.push({ indices: [index], importance: 1 });
  });

  return groups;
}

async function reviewWithNemotron(items) {
  const scope = items[0]?.scope;
  const category = items[0]?.category;
  const scopeRule = scope === "international" ? "outside India" : "in India";
  const prompt = `You are the final news editor for the ${scope}/${category} section. The category means ${categoryGuidance[category]}. The scope means the event must happen ${scopeRule}, or directly concern that scope. Evaluate every article. Keep only meaningful, important events that actually happened AND clearly belong to the requested scope and category. If an article is about a different category or scope, mark keep=false. Remove opinion, promotion, and minor updates. Do not demand that a story be globally historic; a clearly consequential event for this section is sufficient. Use only the supplied article text. Preserve names, dates, numbers, scores and causes. Mark at least the single most important article as keep=true only when a supplied article genuinely belongs in this section. Never keep an article only because it is a headline. Return exactly one decision for every supplied index, including discarded articles. Return ONLY valid JSON with no markdown.

For each item return one decision with this shape:
{"index":0,"keep":true,"rating":0.87}

ARTICLES:\n\n${items.map((item, index) => `INDEX: ${index}\nSCOPE: ${item.scope}\nCATEGORY: ${item.category}\nARTICLE TEXT: ${item.text}`).join("\n\n")}`;
  const ratingPrompt = `${prompt}\nEvery rating must be a continuous numeric value from 0.0 to 1.0; decimals such as 0.1, 0.5, and 0.9 are valid. Use 1.0 for the strongest relevant story and 0.0 for irrelevant or unusable stories.`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryInstruction = attempt === 1
      ? ""
      : "\nYour previous response did not match the required schema. Retry and return every decision with exactly these fields: index, keep, rating.";
    const decisions = await askNemotron(`${ratingPrompt}${retryInstruction}`, 4000);
    const validDecisions = decisions
      .map((decision) => {
        const index = Number(decision.index);
        const rating = decision.rating !== undefined
          ? Number(decision.rating)
          : Number(decision.importance) / 100;
        return { ...decision, index, rating: normalizeRating(rating) };
      })
      .filter((decision) =>
        Number.isInteger(decision.index) &&
        decision.index >= 0 &&
        decision.index < items.length &&
        typeof decision.keep === "boolean" &&
        Number.isFinite(Number(decision.rating))
      );
    const uniqueDecisions = [...new Map(validDecisions.map((decision) => [decision.index, decision])).values()];
    if (uniqueDecisions.length === items.length) return uniqueDecisions;
    console.warn(`Review schema mismatch for ${scope}/${category}: ${uniqueDecisions.length}/${items.length} valid decisions on attempt ${attempt}`);
    if (attempt === 2) return uniqueDecisions;
  }

  return [];
}

async function summarizeEventWithNemotron(items, importance) {
  const sportsInstruction = items[0].category === "sports"
    ? `For sports, facts MUST include these exact keys: sport, match, teams, result, score, top_performer, key_event. Do not reduce a match to a generic victory. Include margin, target, overs, scores, performers, and decisive moments when supplied.`
    : "For non-sports, facts should contain the most useful concrete names, decisions, numbers, locations, or consequences supplied by the reports.";
  const prompt = `You are a concise, neutral news editor. Combine the supplied reports about ONE real-world event. Use only the supplied text; do not invent facts or use outside knowledge. Prefer facts repeated or clearly stated by the reports. NEVER mention any publisher, source, website, report, article, journalist, or source attribution in any summary or fact, under any circumstances. Never begin with meta language such as "This article covers", "According to the report", or "The article states". Begin directly with the event and its facts. Write as a finished news summary, not as commentary, analysis, a description of the writing task, or a full article. ${sportsInstruction}

For micro_summary, write a complete and understandable news sentence using no more than 20 words. It must name the main subject and state the key action, result, or event. Never output a fragment, a sentence beginning with a pronoun, a dangling phrase, or a clipped sentence. Include the most important concrete number or score when one is supplied and can fit.

For summary, write a concise standalone news summary using no more than 40 words. Stop as soon as the essential event, action, result, and concrete facts are clear. Do not expand it into an article, backgrounder, analysis, or commentary.

Return ONLY valid JSON with this exact structure:
{"facts":{"key":"value"},"summary":"concise standalone summary","micro_summary":"short complete summary","extended_summary":"100-150 factual words"}

CATEGORY: ${items[0].category}
EVENT IMPORTANCE: ${importance}/10
  REPORTS:\n\n${items.map((item) => item.text).join("\n\n")}`;
  const summary = await askNemotron(prompt, 1500, "object");
  if (!summary || typeof summary.summary !== "string" || typeof summary.micro_summary !== "string" || typeof summary.extended_summary !== "string" || !summary.facts || typeof summary.facts !== "object") {
    throw new Error("Nemotron returned an invalid event summary");
  }
  const facts = Object.fromEntries(Object.entries(summary.facts).filter(([key, value]) => typeof key === "string" && typeof value === "string"));
  if (items[0].category === "sports") {
    for (const key of ["sport", "match", "teams", "result", "score", "top_performer", "key_event"]) {
      if (!(key in facts)) facts[key] = "";
    }
  }
  return {
    facts,
    summary: limitWords(summary.summary, 40),
    micro_summary: limitWords(summary.micro_summary, 20),
    extended_summary: limitWords(summary.extended_summary, 150),
  };
}

async function classifyArticlesIntoEventsWithNemotron(scope, category, articles, events) {
  const existingEvents = events.map((event) => ({
    event_id: event.event_id,
    article_titles: event.articles.map((article) => article.title).slice(0, 3),
    sources: event.sources,
  }));
  const prompt = `You are maintaining the ${scope}/${category} news event list. For each new article, decide whether it belongs to one existing event or starts a new event. Articles belong together only when they describe the same real-world event, not merely the same topic. Return one assignment for every article. Use an existing event_id exactly when matching; otherwise use a unique value beginning with new_. Return ONLY valid JSON.

Return this shape:
{"assignments":[{"article_index":0,"event_id":"existing-id-or-new_0"}]}

EXISTING EVENTS:
${JSON.stringify(existingEvents)}

NEW ARTICLES:
${articles.map((article, index) => `ARTICLE_INDEX: ${index}\nHEADLINE: ${article.title}\nTEXT: ${article.text}\nURL: ${article.url}`).join("\n\n")}`;
  const response = await askNemotron(prompt, 3000, "object");
  const rawAssignments = Array.isArray(response?.assignments) ? response.assignments : [];
  const existingIds = new Set(events.map((event) => event.event_id));
  const usedArticles = new Set();
  const assignments = [];

  rawAssignments.forEach((assignment) => {
    const articleIndex = Number(assignment.article_index);
    const eventId = String(assignment.event_id || "");
    if (!Number.isInteger(articleIndex) || articleIndex < 0 || articleIndex >= articles.length || usedArticles.has(articleIndex)) return;
    if (!eventId || (eventId !== "new" && !eventId.startsWith("new_") && !existingIds.has(eventId))) return;
    usedArticles.add(articleIndex);
    assignments.push({ articleIndex, eventId });
  });

  articles.forEach((_article, articleIndex) => {
    if (!usedArticles.has(articleIndex)) assignments.push({ articleIndex, eventId: `new_${articleIndex}` });
  });
  return assignments;
}

async function buildEventsIncrementally(scope, category, articles) {
  const events = [];
  let nextEventNumber = 1;

  for (let start = 0; start < articles.length; start += 5) {
    const batch = articles.slice(start, start + 5);
    let assignments;
    try {
      assignments = await classifyArticlesIntoEventsWithNemotron(scope, category, batch, events);
    } catch (error) {
      console.warn(`Event classification failed for ${scope}/${category}: ${error.message}; treating batch articles as separate events`);
      assignments = batch.map((_article, index) => ({ articleIndex: index, eventId: `new_${index}` }));
    }
    const grouped = new Map();
    assignments.forEach(({ articleIndex, eventId }) => {
      if (!grouped.has(eventId)) grouped.set(eventId, []);
      grouped.get(eventId).push(batch[articleIndex]);
    });

    for (const [assignmentId, assignedArticles] of grouped) {
      let event = events.find((candidate) => candidate.event_id === assignmentId);
      if (!event) {
        event = {
          event_id: `${scope}-${category}-${nextEventNumber++}`,
          articles: [],
          sources: [],
          scope,
          category,
        };
        events.push(event);
      }
      event.articles.push(...assignedArticles);
      event.sources = [...new Set(event.articles.map((article) => article.url).filter(Boolean))];
      event.timestamp = event.articles.map((article) => article.published).find(Boolean) || "";
    }
  }

  // Summarize only after all batches have been grouped, so each event is summarized once.
  await Promise.all(events.map(async (event) => {
    try {
      const summary = await summarizeEventWithNemotron(event.articles, 5);
      event.facts = summary.facts;
      event.summary = summary.summary;
      event.micro_summary = summary.micro_summary;
      event.extended_summary = summary.extended_summary;
    } catch (error) {
      console.warn(`Event summary failed for ${scope}/${category}: ${error.message}; using extracted article fallback`);
      const firstArticle = event.articles[0];
      event.facts = {};
      event.summary = firstArticle.title.trim();
      event.micro_summary = firstArticle.title.trim();
      event.extended_summary = limitWords(firstArticle.text, 150);
    }
    logPipeline("event_updated", {
      event_id: event.event_id,
      scope,
      category,
      article_count: event.articles.length,
      sources: event.sources,
      summary: event.summary,
    });
  }));

  return events;
}

async function rateEventsWithNemotron(scope, category, events) {
  const prompt = `You are rating the completed ${scope}/${category} news events for usefulness to readers. Rate every event independently from 0.0 to 1.0. Use 1.0 for the most important, useful, well-supported event in this category and 0.0 for irrelevant, minor, vague, or weak events. Return exactly one rating for every event. Return ONLY valid JSON.

Return this shape:
{"ratings":[{"event_index":0,"rating":0.87}]}

EVENTS:
${events.map((event, index) => `EVENT_INDEX: ${index}\nSUMMARY: ${event.summary}\nDETAILS: ${event.extended_summary}\nSOURCES: ${event.sources.join(", ")}`).join("\n\n")}`;
  let ratings = [];
  try {
    const response = await askNemotron(prompt, 2500, "object");
    const rawRatings = Array.isArray(response?.ratings) ? response.ratings : [];
    ratings = rawRatings
      .map((item) => ({ eventIndex: Number(item.event_index), rating: normalizeRating(item.rating) }))
      .filter((item) => Number.isInteger(item.eventIndex) && item.eventIndex >= 0 && item.eventIndex < events.length)
      .filter((item, index, values) => values.findIndex((candidate) => candidate.eventIndex === item.eventIndex) === index);
  } catch (error) {
    console.warn(`Event rating failed for ${scope}/${category}: ${error.message}`);
  }

  const ratingByIndex = new Map(ratings.map((item) => [item.eventIndex, item.rating]));
  return events.map((event, index) => ({
    ...event,
    rating: ratingByIndex.has(index) ? ratingByIndex.get(index) : 0.5,
    rating_source: ratingByIndex.has(index) ? "ai" : "rating_fallback",
  }));
}

async function deduplicateFinalEventsWithNemotron(events) {
  if (events.length < 2) return events;

  const groupsByBucket = new Map();
  events.forEach((event, index) => {
    const bucket = `${event.scope}/${event.category}`;
    if (!groupsByBucket.has(bucket)) groupsByBucket.set(bucket, []);
    groupsByBucket.get(bucket).push({ event, index });
  });

  const deduplicated = [];
  for (const [bucket, entries] of groupsByBucket) {
    if (entries.length < 2) {
      deduplicated.push(entries[0].event);
      continue;
    }

    const prompt = `You are performing the final duplicate check for the ${bucket} news section. Group events only when they describe the same real-world event. Events about the same topic, person, company, sport, or conflict but different incidents must remain separate. Every supplied index must appear exactly once in one group. Return ONLY valid JSON.

Return this shape:
{"groups":[{"indices":[0,1]}]}

EVENTS:\n\n${entries.map(({ event }, index) => `INDEX: ${index}\nSUMMARY: ${event.summary}\nDETAILS: ${event.extended_summary}\nSOURCES: ${event.sources.join(", ")}`).join("\n\n")}`;

    let groups;
    try {
      const response = await askNemotron(prompt, 2500, "object");
      const assigned = new Set();
      groups = [];
      for (const group of Array.isArray(response?.groups) ? response.groups : []) {
        const indices = [...new Set(
          (Array.isArray(group.indices) ? group.indices : [])
            .filter((index) => Number.isInteger(index) && index >= 0 && index < entries.length && !assigned.has(index))
        )];
        if (!indices.length) continue;
        indices.forEach((index) => assigned.add(index));
        groups.push(indices);
      }
      entries.forEach((_entry, index) => {
        if (!assigned.has(index)) groups.push([index]);
      });
    } catch (error) {
      console.warn(`Final event deduplication failed for ${bucket}: ${error.message}; retaining events`);
      groups = entries.map((_entry, index) => [index]);
    }

    for (const indices of groups) {
      const groupedEvents = indices.map((index) => entries[index].event);
      const representative = [...groupedEvents].sort((left, right) =>
        (right.rating ?? 0) - (left.rating ?? 0)
      )[0];
      const mergedSources = [...new Set(groupedEvents.flatMap((event) => event.sources || []))];
      deduplicated.push({
        ...representative,
        sources: mergedSources,
        facts: groupedEvents.reduce((facts, event) => ({ ...facts, ...(event.facts || {}) }), {}),
      });
      if (groupedEvents.length > 1) {
        logPipeline("final_duplicate_events_merged", {
          scope: representative.scope,
          category: representative.category,
          event_ids: groupedEvents.map((event) => event.event_id),
          retained_event_id: representative.event_id,
          sources: mergedSources,
        });
      }
    }
  }

  return deduplicated;
}

async function compareEventsWithPreviousWithNemotron(entries, previousEntries) {
  const prompt = `You are checking whether newly selected news events repeat events from the last two editions. Compare structured facts first, using the summary only as supporting context. Match only the same real-world event, not the same person, topic, company, sport, conflict, or ongoing issue when the incident is different. Return the highest similarity for every new event. Use a continuous value from 0.0 to 1.0. Return ONLY valid JSON.

Return this shape:
{"comparisons":[{"event_index":0,"similarity":0.87,"previous_edition_date":"2026-08-27","previous_event_index":1}]}

NEW EVENTS:
${entries.map(({ event }, index) => `NEW_EVENT_INDEX: ${index}\nFACTS: ${JSON.stringify(event.facts || {})}\nSUMMARY: ${event.summary}`).join("\n\n")}

PREVIOUS EVENTS:
${previousEntries.map((event, index) => `PREVIOUS_EVENT_INDEX: ${index}\nEDITION_DATE: ${event.editionDate}\nFACTS: ${JSON.stringify(event.facts || {})}\nSUMMARY: ${event.summary}`).join("\n\n")}`;

  const response = await askNemotron(prompt, 2500, "object");
  const comparisons = Array.isArray(response?.comparisons) ? response.comparisons : [];
  return comparisons
    .map((item) => ({
      eventIndex: Number(item.event_index),
      similarity: normalizeRating(item.similarity),
      previousEditionDate: String(item.previous_edition_date || ""),
      previousEventIndex: Number(item.previous_event_index),
    }))
    .filter((item) => Number.isInteger(item.eventIndex) && item.eventIndex >= 0 && item.eventIndex < entries.length)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.eventIndex === item.eventIndex) === index);
}

async function filterRepeatedEventsFromPreviousEditions(events, previousEvents) {
  if (!events.length || !previousEvents.length) return events;

  const buckets = new Map();
  events.forEach((event) => {
    const bucket = `${event.scope}/${event.category}`;
    if (!buckets.has(bucket)) buckets.set(bucket, { entries: [], previousEntries: [] });
    buckets.get(bucket).entries.push({ event });
  });
  previousEvents.forEach((event) => {
    const bucket = `${event.scope}/${event.category}`;
    if (!buckets.has(bucket)) buckets.set(bucket, { entries: [], previousEntries: [] });
    buckets.get(bucket).previousEntries.push(event);
  });

  const tasks = [...buckets.entries()]
    .filter(([, bucket]) => bucket.entries.length && bucket.previousEntries.length)
    .map(([bucket, value]) => ({ bucket, ...value }));
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      try {
        results[index] = {
          task,
          comparisons: await compareEventsWithPreviousWithNemotron(task.entries, task.previousEntries),
        };
      } catch (error) {
        console.warn(`Previous-edition comparison failed for ${task.bucket}: ${error.message}; retaining events`);
        results[index] = { task, comparisons: [] };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PREVIOUS_EVENT_COMPARISON_CONCURRENCY, tasks.length) }, () => worker())
  );

  const discarded = new Set();
  results.forEach(({ task, comparisons }) => {
    comparisons.forEach((comparison) => {
      if (comparison.similarity < PREVIOUS_EVENT_SIMILARITY_THRESHOLD) return;
      const event = task.entries[comparison.eventIndex]?.event;
      if (!event) return;
      discarded.add(event.event_id);
      logPipeline("previous_event_discarded", {
        event_id: event.event_id,
        scope: event.scope,
        category: event.category,
        similarity: comparison.similarity,
        threshold: PREVIOUS_EVENT_SIMILARITY_THRESHOLD,
        previous_edition_date: comparison.previousEditionDate,
        previous_event_index: comparison.previousEventIndex,
      });
    });
  });

  return events.filter((event) => !discarded.has(event.event_id));
}

async function saveEdition(date, payload) {
  const endpoint = `${process.env.SUPABASE_URL}/rest/v1/editions?on_conflict=edition_date`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      edition_date: date,
      status: "published",
      payload,
      published_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase write failed: ${await response.text()}`);
}

const today = new Date().toISOString().slice(0, 10);
const previousEditionEvents = await loadPreviousEditions(today);
const feedDefinitions = [
  ...scopes.flatMap((scope) => categories.map((category) => ({
    scope,
    category,
    sourceName: "Google News",
    sourceTier: "signal",
    url: feeds[scope][category],
  }))),
];
const feedTasks = feedDefinitions.map((definition) => ({
  ...definition,
}));
const feedResults = await runFeedTasks(feedTasks);
feedResults.forEach((result, index) => {
  if (result.status === "rejected") {
    const task = feedTasks[index];
    console.warn(`Feed unavailable for ${task.scope}/${task.category}: ${result.reason?.message || result.reason}`);
  }
});
const allFeedsFailedWith503 = feedResults.length === feedTasks.length &&
  feedResults.every((result) =>
    result.status === "rejected" && /HTTP 503\b/.test(result.reason?.message || String(result.reason))
  );
if (allFeedsFailedWith503) {
  console.error("All Google News RSS feeds returned HTTP 503; requesting a delayed workflow retry.");
  process.exit(75);
}
const articles = feedResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
const selected = [];

for (const scope of scopes) {
  for (const category of categories) {
    const fetchedArticles = articles.filter(
      (item) => item.scope === scope && item.category === category
    );
    const categoryArticles = fetchedArticles;

    if (!categoryArticles.length) {
      console.log(`${scope}/${category}: 0 fetched → 0 candidates → 0 extracted → 0 events → 0 selected`);
      continue;
    }

    const locallyDeduplicated = deduplicateLocally(categoryArticles);
    locallyDeduplicated.duplicates.forEach(({ duplicate, kept }) => {
      logPipeline("local_duplicate_removed", {
        scope,
        category,
        duplicate_title: duplicate.title,
        duplicate_url: duplicate.url,
        kept_title: kept.title,
        kept_url: kept.url,
      });
    });
    const extractedArticles = await Promise.all(
      locallyDeduplicated.unique.map(async (item) => {
        const extracted = await articleText(item.url, item.sourceTier);
        extractionMetrics[extracted.status] += 1;
        return {
          ...item,
          text: extracted.text,
          extractionStatus: extracted.status,
          resolvedUrl: extracted.resolvedUrl,
          extractionReason: extracted.reason || "",
        };
      })
    );
    extractedArticles.forEach((item) => {
      logPipeline("story_content_ready", {
        scope,
        category,
        title: item.title,
        url: item.url,
        content_length: item.text.length,
        extraction_status: item.extractionStatus,
        resolved_url: item.resolvedUrl,
        extraction_reason: item.extractionReason,
      });
    });
    const usableArticles = extractedArticles.filter((item) =>
      item.extractionStatus === "full_extraction" || item.extractionStatus === "short_but_valid"
    );
    const fullArticles = usableArticles;
    let events = [];
    try {
      events = await buildEventsIncrementally(scope, category, usableArticles);
      events = await rateEventsWithNemotron(scope, category, events);
    } catch (error) {
      console.warn(`Event pipeline failed for ${scope}/${category}: ${error.message}`);
    }

    const rankedEvents = [...events].sort((a, b) => b.rating - a.rating);
    const publishedEvents = rankedEvents
      .filter((event) => event.rating >= EVENT_PUBLISH_THRESHOLD)
      .slice(0, maxPerCategory);
    publishedEvents.forEach((event) => {
      const publishedEvent = {
        event_id: event.event_id,
        scope,
        category,
        rating: event.rating,
        importance: normalizeImportance(event.rating),
        sources: event.sources,
        facts: event.facts,
        timestamp: event.timestamp,
        summary: event.summary,
        micro_summary: event.micro_summary,
        extended_summary: event.extended_summary,
      };
      selected.push(publishedEvent);
      logPipeline("event_created", {
        ...publishedEvent,
        article_count: event.articles.length,
        rating_source: event.rating_source,
      });
    });

    console.log(`${scope}/${category}: ${fetchedArticles.length} fetched → ${categoryArticles.length} candidates → ${fullArticles.length} extracted → ${events.length} events → ${publishedEvents.length} selected`);
  }
}

const payload = { national: {}, international: {} };
const finalDeduplicated = await deduplicateFinalEventsWithNemotron(selected);
const finalSelected = await filterRepeatedEventsFromPreviousEditions(
  finalDeduplicated,
  previousEditionEvents
);
for (const scope of scopes) {
  for (const category of categories) {
    const categoryEvents = finalSelected
      .filter((item) => item.scope === scope && item.category === category)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxPerCategory);

    if (categoryEvents.length === 0) {
      console.warn(`No major, correctly categorized articles for ${scope}/${category}; publishing that category empty`);
    }

    payload[scope][category] = categoryEvents;
  }
}

await saveEdition(today, payload);
logPipeline("extraction_summary", {
  ...extractionMetrics,
  total_stories_processed: Object.values(extractionMetrics).reduce((total, count) => total + count, 0),
});
console.log(`Published ${today} with ${selected.length} events.`);
