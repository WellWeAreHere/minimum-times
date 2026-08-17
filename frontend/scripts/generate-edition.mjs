import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const parser = new Parser();
const categories = ["politics", "sports", "entertainment", "tragedies"];
const scopes = ["national", "international"];
const maxPerCategory = 4;
const batchSize = 10;
const feedAttempts = 3;

const feeds = {
  national: {
    politics: "https://news.google.com/rss/search?q=India+(government+OR+parliament+OR+election+OR+minister+OR+court)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    sports: "https://news.google.com/rss/search?q=India+(sports+OR+cricket+OR+football)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    entertainment: "https://news.google.com/rss/search?q=India+(actor+OR+film+OR+music+OR+entertainment)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
    tragedies: "https://news.google.com/rss/search?q=India+(earthquake+OR+accident+OR+fire+OR+explosion+OR+flood+OR+crash)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
  },
  international: {
    politics: "https://news.google.com/rss/search?q=(government+OR+parliament+OR+election+OR+president+OR+court)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    sports: "https://news.google.com/rss/search?q=(sports+OR+football+OR+tennis+OR+Olympics)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    entertainment: "https://news.google.com/rss/search?q=(actor+OR+film+OR+music+OR+entertainment)+-India+when:1d&hl=en&gl=US&ceid=US:en",
    tragedies: "https://news.google.com/rss/search?q=(earthquake+OR+accident+OR+fire+OR+explosion+OR+flood+OR+crash)+-India+when:1d&hl=en&gl=US&ceid=US:en",
  },
};

const required = ["NVIDIA_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is missing`);
}

async function articleText(url, fallback) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "Mozilla/5.0 Minimum Times/1.0" },
    });
    if (!response.ok) return fallback;
    const html = await response.text();
    const document = new JSDOM(html, { url: response.url || url }).window.document;
    const parsed = new Readability(document).parse();
    return parsed?.textContent?.replace(/\s+/g, " ").trim().slice(0, 6000) || fallback;
  } catch {
    return fallback;
  }
}

async function fetchFeed(scope, category, url) {
  let lastError;

  for (let attempt = 1; attempt <= feedAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await parser.parseString(await response.text());
      const items = feed.items.slice(0, 25);
      if (items.length === 0) throw new Error("empty feed");

      return Promise.all(items.map(async (item) => ({
        scope,
        category,
        title: item.title || "Untitled story",
        url: item.link || "https://news.google.com/",
        published: item.pubDate || "",
        text: item.contentSnippet || item.content || "",
      })));
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Feed failed after ${feedAttempts} attempts: ${scope}/${category} (${lastError?.message || "unknown error"})`);
}

async function askNemotron(prompt, maxTokens) {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(55000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-super-120b-a12b",
      temperature: 1,
      top_p: 0.95,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`NVIDIA request failed (${response.status})`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
  return Array.isArray(parsed) ? parsed : parsed.decisions || [];
}

async function deduplicateWithNemotron(items) {
  const prompt = `You are a news deduplication editor. Group headlines that report the same real-world event, even when wording or publishers differ. Keep exactly one representative from each group, preferring the clearest and most authoritative headline. Do not discard distinct events. Return ONLY valid JSON.

For every item return one decision with this shape:
{"index":0,"keep":true}

HEADLINES:\n\n${items.map((item, index) => `INDEX: ${index}\nHEADLINE: ${item.title}\nURL: ${item.url}`).join("\n\n")}`;

  return askNemotron(prompt, 2000);
}

async function reviewWithNemotron(items) {
  const prompt = `You are the final news editor. Evaluate every article. Keep only meaningful, important events that actually happened. Remove opinion, promotion, and minor updates. Use only the supplied article text. Preserve names, dates, numbers, scores and causes. Mark at least the single most important article as keep=true when articles are supplied. Never keep an article only because it is a headline. Return ONLY valid JSON.

For each item return one decision with this shape:
{"index":0,"keep":true,"importance":95,"short_summary":"maximum 30 words","extended_summary":"100-150 factual words"}

ARTICLES:\n\n${items.map((item, index) => `INDEX: ${index}\nSCOPE: ${item.scope}\nCATEGORY: ${item.category}\nHEADLINE: ${item.title}\nARTICLE TEXT: ${item.text}`).join("\n\n")}`;

  return askNemotron(prompt, 8000);
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
const feedTasks = scopes.flatMap((scope) =>
  categories.map((category) => ({
    scope,
    category,
    promise: fetchFeed(scope, category, feeds[scope][category]),
  }))
);
const feedResults = await Promise.allSettled(feedTasks.map((task) => task.promise));
feedResults.forEach((result, index) => {
  if (result.status === "rejected") {
    const task = feedTasks[index];
    console.warn(`Feed unavailable for ${task.scope}/${task.category}: ${result.reason?.message || result.reason}`);
  }
});
const articles = feedResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
const selected = [];
const reviewed = [];

for (const scope of scopes) {
  for (const category of categories) {
    const categoryArticles = articles.filter(
      (item) => item.scope === scope && item.category === category
    );

    if (categoryArticles.length === 0) {
      continue;
    }

    const dedupeDecisions = await deduplicateWithNemotron(categoryArticles);
    const deduplicatedArticles = dedupeDecisions
      .filter((decision) => decision.keep === true && categoryArticles[decision.index])
      .map((decision) => categoryArticles[decision.index]);
    const headlineArticles = deduplicatedArticles.length > 0 ? deduplicatedArticles : categoryArticles;
    const reviewArticles = await Promise.all(
      headlineArticles.map(async (item) => ({
        ...item,
        text: await articleText(item.url, item.text),
      }))
    );

    for (let start = 0; start < reviewArticles.length; start += batchSize) {
      const batch = reviewArticles.slice(start, start + batchSize);
      const decisions = await reviewWithNemotron(batch);
      for (const decision of decisions) {
        const item = batch[decision.index];
        if (!item || !decision.short_summary) continue;
        const reviewedArticle = {
          ...item,
          short_summary: decision.short_summary,
          extended_summary: decision.extended_summary || item.text.slice(0, 1000),
          importance: Number(decision.importance) || 0,
        };
        reviewed.push(reviewedArticle);
        if (decision.keep) selected.push(reviewedArticle);
      }
    }
  }
}

const payload = { national: {}, international: {} };
for (const scope of scopes) {
  for (const category of categories) {
    const categoryArticles = selected
      .filter((item) => item.scope === scope && item.category === category)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxPerCategory);

    if (categoryArticles.length === 0) {
      const fallback = reviewed
        .filter((item) => item.scope === scope && item.category === category)
        .sort((a, b) => b.importance - a.importance)[0];

      if (fallback) {
        categoryArticles.push(fallback);
      }
    }

    if (categoryArticles.length === 0) {
      const rawFallback = articles
        .filter((item) => item.scope === scope && item.category === category)
        .slice(0, maxPerCategory)
        .map((item) => ({
          ...item,
          short_summary: item.title,
          extended_summary: item.text || item.title,
          importance: 0,
        }));

      categoryArticles.push(...rawFallback);
    }

    if (categoryArticles.length === 0) {
      console.warn(`No articles available for ${scope}/${category}; publishing that category empty`);
    }

    payload[scope][category] = categoryArticles;
  }
}

await saveEdition(today, payload);
console.log(`Published ${today} with ${selected.length} selected articles.`);
