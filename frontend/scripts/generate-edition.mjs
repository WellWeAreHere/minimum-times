import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const parser = new Parser();
const categories = ["politics", "sports", "business", "science", "entertainment", "tragedies"];
const scopes = ["national", "international"];
const maxPerCategory = 4;
const batchSize = 3;
const dedupeBatchSize = 10;
const feedAttempts = 3;
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

function limitWords(value, maxWords) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
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
      const items = feed.items.slice(0, 50);
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
        (payload?.[scope]?.[category] || []).map((article) => ({
          scope,
          category,
          title: article.short_summary || article.title || "",
          url: article.url || "",
        }))
      )
    );
  } catch (error) {
    console.warn(`Previous edition unavailable: ${error.message}`);
    return [];
  }
}

async function askNemotron(prompt, maxTokens, responseType = "array") {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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

  if (!response.ok) throw new Error(`NVIDIA request failed (${response.status})`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
  if (responseType === "object") return parsed;
  return Array.isArray(parsed) ? parsed : parsed.decisions || [];
}

async function deduplicateWithNemotron(items) {
  const prompt = `You are a news deduplication editor. Group headlines that report the same real-world event, even when wording or publishers differ. Keep exactly one representative from each group, preferring the clearest and most authoritative headline. Do not discard distinct events. You must return one decision for every supplied index. Return ONLY valid JSON.

For every item return one decision with this shape:
{"index":0,"keep":true}

ARTICLES:\n\n${items.map((item, index) => {
    const summary = item.extended_summary || item.short_summary || item.text || "";
    return `INDEX: ${index}\nHEADLINE: ${item.title}\nSUMMARY: ${summary}\nURL: ${item.url}`;
  }).join("\n\n")}`;

  return askNemotron(prompt, 2000);
}

async function hierarchicalDeduplicate(items) {
  let survivors = [];
  for (let start = 0; start < items.length; start += dedupeBatchSize) {
    const batch = items.slice(start, start + dedupeBatchSize);
    const decisions = await deduplicateWithNemotron(batch);
    const batchSurvivors = decisions
      .filter((decision) => decision.keep === true && batch[decision.index])
      .map((decision) => batch[decision.index]);
    survivors.push(...(batchSurvivors.length ? batchSurvivors : batch));
  }

  while (survivors.length > dedupeBatchSize) {
    const next = [];
    for (let start = 0; start < survivors.length; start += dedupeBatchSize) {
      const batch = survivors.slice(start, start + dedupeBatchSize);
      const decisions = await deduplicateWithNemotron(batch);
      const batchSurvivors = decisions
        .filter((decision) => decision.keep === true && batch[decision.index])
        .map((decision) => batch[decision.index]);
      next.push(...(batchSurvivors.length ? batchSurvivors : batch));
    }
    if (next.length >= survivors.length) break;
    survivors = next;
  }

  if (survivors.length > 1) {
    const decisions = await deduplicateWithNemotron(survivors);
    const finalSurvivors = decisions
      .filter((decision) => decision.keep === true && survivors[decision.index])
      .map((decision) => survivors[decision.index]);
    if (finalSurvivors.length) survivors = finalSurvivors;
  }

  return survivors;
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

async function summarizeArticleWithNemotron(article) {
  const prompt = `You are a concise news editor. Summarize the supplied article text only. Do not use outside knowledge and do not invent facts. Preserve important names, dates, numbers, scores, causes, and consequences.

Return ONLY valid JSON with this exact structure:
{"short_summary":"maximum 30 words","micro_summary":"maximum 10 words, terse factual wording","extended_summary":"100-150 factual words"}

CATEGORY: ${article.category}
ARTICLE TEXT:
${article.text}`;

  const summary = await askNemotron(prompt, 1200, "object");

  if (
    !summary ||
    typeof summary.short_summary !== "string" ||
    typeof summary.micro_summary !== "string" ||
    typeof summary.extended_summary !== "string"
  ) {
    throw new Error("Nemotron returned an invalid article summary");
  }

  return summary;
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

    const reviewArticles = await Promise.all(
      categoryArticles.map(async (item) => ({
        ...item,
        text: await articleText(item.url, item.text),
      }))
    );
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
      .slice(0, maxPerCategory);
    let deduplicatedArticles = candidates;

    if (candidates.length > 1) {
      try {
        deduplicatedArticles = await hierarchicalDeduplicate(candidates);
      } catch (error) {
        console.warn(`Deduplication failed for ${scope}/${category}: ${error.message}`);
      }
    }

    for (const article of deduplicatedArticles) {
      try {
        const summary = await summarizeArticleWithNemotron(article);
        selected.push({
          ...article,
          short_summary: limitWords(summary.short_summary, 30),
          micro_summary: limitWords(summary.micro_summary, 10),
          extended_summary: limitWords(summary.extended_summary, 150),
        });
      } catch (error) {
        console.warn(`Summary failed for ${scope}/${category}: ${error.message}`);
      }
    }

    const headlineArticles = deduplicatedArticles;

    console.log(`${scope}/${category}: ${fetchedArticles.length} fetched → ${previousMatches.length} similar to previous edition → ${categoryArticles.length} new → ${headlineArticles.length} deduplicated → ${reviewBatchCount} review batches (${validDecisionCount} valid decisions) → ${keptCount} kept`);
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
      console.warn(`No major, correctly categorized articles for ${scope}/${category}; publishing that category empty`);
    }

    payload[scope][category] = categoryArticles;
  }
}

await saveEdition(today, payload);
console.log(`Published ${today} with ${selected.length} selected articles.`);
