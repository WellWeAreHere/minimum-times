import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");

const parser = new Parser();
const googleDecoder = new GoogleDecoder();
const categories = ["politics", "sports", "business", "science", "entertainment", "tragedies"];
const scopes = ["national", "international"];
const maxPerCategory = 4;
const batchSize = 3;
const feedAttempts = 2;
const MIN_SHORT_VALID_WORDS = 40;
const MIN_FULL_EXTRACTION_WORDS = 120;
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

const directFeeds = [
  {
    scope: "national",
    category: "politics",
    sourceName: "PIB India",
    sourceTier: "primary",
    url: "https://pib.gov.in/RssMain.aspx",
  },
  {
    scope: "national",
    category: "business",
    sourceName: "RBI",
    sourceTier: "primary",
    url: "https://www.rbi.org.in/pressreleases_rss.aspx",
  },
];

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
  return Math.max(1, Math.min(10, Math.round(Number(value) / 10) || 1));
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
    const result = await googleDecoder.decode(url);
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
    const document = new JSDOM(body, { url: response.url || resolved.url }).window.document;
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
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await parser.parseString(await response.text());
      const items = feed.items.slice(0, 50);
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
    }
  }

  throw new Error(`Feed failed after ${feedAttempts} attempts: ${scope}/${category} (${lastError?.message || "unknown error"})`);
}

async function loadPreviousEdition(date) {
  const endpoint = `${process.env.SUPABASE_URL}/rest/v1/editions?status=eq.published&edition_date=lt.${date}&select=payload&order=edition_date.desc&limit=1`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
    const rows = await response.json();
    const payload = rows[0]?.payload;
    return scopes.flatMap((scope) =>
      categories.flatMap((category) =>
        (payload?.[scope]?.[category] || []).map((event) => ({
          scope,
          category,
          title: event.summary || event.short_summary || event.title || "",
          url: event.sources?.[0] || event.url || "",
        }))
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
{"index":0,"keep":true,"importance":95}

ARTICLES:\n\n${items.map((item, index) => `INDEX: ${index}\nSCOPE: ${item.scope}\nCATEGORY: ${item.category}\nARTICLE TEXT: ${item.text}`).join("\n\n")}`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryInstruction = attempt === 1
      ? ""
      : "\nYour previous response did not match the required schema. Retry and return every decision with exactly these fields: index, keep, importance.";
    const decisions = await askNemotron(`${prompt}${retryInstruction}`, 4000);
    const validDecisions = decisions.filter((decision) =>
      Number.isInteger(decision.index) &&
      decision.index >= 0 &&
      decision.index < items.length &&
      typeof decision.keep === "boolean" &&
      Number.isFinite(Number(decision.importance))
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
  const prompt = `You are a concise event editor. Combine the supplied reports about ONE real-world event. Use only the supplied text; do not invent facts or use outside knowledge. Prefer facts repeated or clearly stated by sources. ${sportsInstruction}

Return ONLY valid JSON with this exact structure:
{"facts":{"key":"value"},"summary":"maximum 30 words","micro_summary":"maximum 10 words","extended_summary":"100-150 factual words"}

CATEGORY: ${items[0].category}
EVENT IMPORTANCE: ${importance}/10
REPORTS:\n\n${items.map((item, index) => `SOURCE ${index + 1}: ${item.url}\n${item.text}`).join("\n\n")}`;
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
    summary: limitWords(summary.summary, 30),
    micro_summary: limitWords(summary.micro_summary, 10),
    extended_summary: limitWords(summary.extended_summary, 150),
  };
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
const previousEditionArticles = await loadPreviousEdition(today);
const feedDefinitions = [
  ...scopes.flatMap((scope) => categories.map((category) => ({
    scope,
    category,
    sourceName: "Google News",
    sourceTier: "signal",
    url: feeds[scope][category],
  }))),
  ...directFeeds,
];
const feedTasks = feedDefinitions.map((definition) => ({
  ...definition,
  promise: fetchFeed(definition),
}));
const feedResults = await Promise.allSettled(feedTasks.map((task) => task.promise));
feedResults.forEach((result, index) => {
  if (result.status === "rejected") {
    const task = feedTasks[index];
    console.warn(`Feed unavailable for ${task.scope}/${task.category}: ${result.reason?.message || result.reason}`);
  }
});
const articles = feedResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
const selected = [];

for (const scope of scopes) {
  for (const category of categories) {
    const fetchedArticles = articles.filter(
      (item) => item.scope === scope && item.category === category
    );
    const previousMatches = fetchedArticles.filter((item) =>
      previousEditionArticles.some((previous) =>
        previous.scope === scope && previous.category === category && sameStory(item, previous)
      )
    );
    const categoryArticles = fetchedArticles.filter((item) => !previousMatches.includes(item));

    if (!categoryArticles.length) {
      console.log(`${scope}/${category}: ${fetchedArticles.length} fetched → ${previousMatches.length} similar to previous edition → 0 new → 0 deduplicated → 0 reviewed → 0 kept`);
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
    const reviewArticles = extractedArticles.filter((item) => item.text);
    const keptArticles = [];
    let keptCount = 0;
    let reviewBatchCount = 0;
    let validDecisionCount = 0;

    try {
      for (let start = 0; start < reviewArticles.length; start += batchSize) {
        const batch = reviewArticles.slice(start, start + batchSize);
        reviewBatchCount += 1;
        const decisions = await reviewWithNemotron(batch);
        validDecisionCount += decisions.length;
        for (const decision of decisions) {
          const item = batch[decision.index];
          if (!item) continue;
          const reviewedArticle = {
            ...item,
            importance: Number(decision.importance) || 0,
          };
          if (decision.keep) {
            keptArticles.push(reviewedArticle);
          }
        }
      }
    } catch (error) {
      console.warn(`Review failed for ${scope}/${category}: ${error.message}`);
    }

    keptCount = keptArticles.length;
    const candidates = keptArticles
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxPerCategory * 3);
    let eventGroups = candidates.map((article, index) => ({
      indices: [index],
      importance: normalizeImportance(article.importance),
    }));
    const headlineArticles = eventGroups;
    if (candidates.length > 1) {
      try {
        eventGroups = await groupEventsWithNemotron(candidates);
      } catch (error) {
        console.warn(`Event grouping failed for ${scope}/${category}: ${error.message}`);
      }
    }

    for (const [eventIndex, group] of eventGroups.entries()) {
      const eventArticles = group.indices.map((index) => candidates[index]).filter(Boolean);
      if (!eventArticles.length) continue;
      try {
        const summary = await summarizeEventWithNemotron(eventArticles, group.importance);
        selected.push({
          event_id: `${scope}-${category}-${eventIndex + 1}`,
          scope,
          category,
          importance: group.importance,
          sources: eventArticles.map((article) => article.url).filter(Boolean),
          facts: summary.facts,
          timestamp: eventArticles.map((article) => article.published).find(Boolean) || "",
          summary: summary.summary,
          micro_summary: summary.micro_summary,
          extended_summary: summary.extended_summary,
        });
        logPipeline("event_created", {
          event_id: `${scope}-${category}-${eventIndex + 1}`,
          scope,
          category,
          importance: group.importance,
          source_count: eventArticles.length,
          sources: eventArticles.map((article) => article.url).filter(Boolean),
          facts: summary.facts,
          summary: summary.summary,
          micro_summary: summary.micro_summary,
          extended_summary: summary.extended_summary,
        });
      } catch (error) {
        console.warn(`Event summary failed for ${scope}/${category}: ${error.message}`);
      }
    }

    console.log(`${scope}/${category}: ${fetchedArticles.length} fetched → ${previousMatches.length} similar to previous edition → ${categoryArticles.length} new → ${headlineArticles.length} deduplicated → ${reviewBatchCount} review batches (${validDecisionCount} valid decisions) → ${keptCount} kept`);
  }
}

const payload = { national: {}, international: {} };
for (const scope of scopes) {
  for (const category of categories) {
    const categoryEvents = selected
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
