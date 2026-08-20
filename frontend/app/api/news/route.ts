import Parser from "rss-parser";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const parser = new Parser();

const FEEDS = {
  politics:
    "https://news.google.com/rss/search?q=India+(government+OR+parliament+OR+election+OR+minister+OR+court)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",

  sports:
    "https://news.google.com/rss/search?q=India+(sports+OR+cricket+OR+football)+when:1d&hl=en-IN&gl=IN&ceid=IN:en",

  entertainment:
    "https://news.google.com/rss/search?q=India+(actor+OR+film+OR+music+OR+entertainment)+when:1d&hl=en-IN&gl=IN:en",

  tragedies:
    "https://news.google.com/rss/search?q=(earthquake+OR+accident+OR+fire+OR+explosion+OR+flood+OR+crash)+when:1d&hl=en-IN&gl=IN:en",
} as const;

type Category = keyof typeof FEEDS;

type FeedArticle = {
  title: string;
  url: string;
  published: string;
  category: Category;
  context: string;
  details: string;
};

type AiDecision = {
  index: number;
  keep: boolean;
  summary: string;
  details?: string;
};

let cachedNews: FeedArticle[] | null = null;
let cachedAt = 0;
let inFlight: Promise<FeedArticle[]> | null = null;

const CACHE_MS = 10 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "AI timed out after " + milliseconds / 1000 + " seconds"
            )
          ),
        milliseconds
      )
    ),
  ]);
}

async function readArticle(url: string, fallback: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent": "Mozilla/5.0 Minimum Times/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return fallback;
    }

    const html = await response.text();
    const document = new JSDOM(html, { url: response.url || url }).window.document;
    const parsed = new Readability(document).parse();

    return parsed?.textContent?.replace(/\s+/g, " ").trim() || fallback;
  } catch (error) {
    console.warn("ARTICLE CONTENT FETCH FAILED:", url, error);
    return fallback;
  }
}

async function getFeed(category: Category): Promise<FeedArticle[]> {
  const response = await fetch(FEEDS[category], {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": "Mozilla/5.0 Minimum Times/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`News feed failed (${response.status})`);
  }

  const feed = await parser.parseString(await response.text());

  const items = feed.items.slice(0, 5);

  return Promise.all(
    items.map(async (item) => {
      const url = item.link || "https://news.google.com/";
      const fallback = item.contentSnippet || item.content || "";

      return {
        title: item.title || "Untitled story",
        url,
        published: item.pubDate || "",
        category,
        context: await readArticle(url, fallback),
        details: "",
      };
    })
  );
}

function limitWords(value: string, maxWords: number) {
  return value.trim().split(/\s+/).slice(0, maxWords).join(" ");
}

function isAiDecision(value: unknown): value is AiDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  const decision = value as Record<string, unknown>;

  return (
    Number.isInteger(decision.index) &&
    typeof decision.keep === "boolean" &&
    typeof decision.summary === "string"
  );
}

function parseAiDecisions(value: string): AiDecision[] {
  const cleaned = value
    .trim()
    .replace(/^\x60{3}(?:json)?\s*/i, "")
    .replace(/\s*\x60{3}$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;

  // Case 1:
  // [
  //   {"index":0,"keep":true,"summary":"..."}
  // ]
  if (Array.isArray(parsed)) {
    return parsed.filter(isAiDecision);
  }

  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;

    // Case 2:
    // {
    //   "decisions": [
    //      ...
    //   ]
    // }
    if (Array.isArray(object.decisions)) {
      return object.decisions.filter(isAiDecision);
    }

    // Case 3:
    // Nemotron sometimes returns ONE decision object
    //
    // {
    //   "index": 4,
    //   "keep": true,
    //   "summary": "..."
    // }
    if (isAiDecision(object)) {
      return [object];
    }
  }

  throw new Error("Nemotron returned invalid JSON decisions");
}

async function filterAndSummarize(
  articles: FeedArticle[]
): Promise<AiDecision[]> {
  const key = process.env.NVIDIA_API_KEY?.trim();

  if (!key) {
    throw new Error(
      "NVIDIA_API_KEY is missing from frontend/.env.local"
    );
  }

  const prompt = [
    "You are a news editor.",
    "",
    "Evaluate EVERY article below.",
    "",
    "IMPORTANT OUTPUT RULES:",
    "1. Return exactly ONE decision for EVERY article.",
    "2. Never omit an article.",
    "3. Use the exact INDEX provided for each article.",
    "4. Do NOT explain your reasoning.",
    "5. Do NOT write anything before or after the JSON.",
    "6. Return ONLY valid JSON.",
    "",
    "KEEP an article if it reports a meaningful real-world event that actually happened.",
    "",
    "KEEP meaningful facts such as:",
    "- election results",
    "- major government decisions",
    "- major court decisions",
    "- significant political developments",
    "- significant sports results or scoreboards",
    "- major entertainment events",
    "- serious accidents or disasters",
    "",
    "DISCARD:",
    "- opinion/editorial pieces",
    "- routine politician visits or ceremonial appearances",
    "- promotional publicity",
    "- minor updates",
    "- duplicate reports about the same event",
    "",
    "For every KEEP article:",
    "- Write a factual summary.",
    "- Maximum 30 words.",
    "- Preserve important names, numbers, results and causes.",
    "- Never invent facts.",
    "- Base the summary on the DETAILS text, not only the headline.",
    "- Include concrete numbers, dates, names and results from DETAILS whenever they are available.",
    "- Also write an extended factual summary of 100-150 words for readers who click the headline.",
    "- The extended summary must only use the headline and details provided below.",
    "- Do not mention where the information came from, do not mention publisher, DO NOT put per source in end",
    "- GOOD : Thousands displaced , BAD : thousands displaced, per BBC", 
    "",
    "For every DISCARD article:",
    '- Use an empty summary: ""',
    "",
    'OUTPUT EXACTLY THIS STRUCTURE:',
    '{"decisions":[{"index":0,"keep":false,"summary":"","details":""},{"index":1,"keep":true,"summary":"Example summary","details":"Extended factual summary."}]}',
    "",
    "ARTICLES:",
    "",
    ...articles.map(
      (article, index) =>
        `INDEX: ${index}\n` +
        `CATEGORY: ${article.category}\n` +
        `HEADLINE: ${article.title}\n` +
        `DETAILS: ${article.context.slice(0, 5000)}`
    ),
  ].join("\n\n");

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 60000);

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },

        body: JSON.stringify({
          model: "nvidia/nemotron-3-ultra-550b-a55b",

          temperature: 1,
          top_p: 0.95,

          max_tokens: 8000,

          reasoning_effort: "none",

          response_format: {
            type: "json_object",
          },

          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);

      throw new Error(
        `NVIDIA request failed (${response.status}): ${detail}`
      );
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error("NVIDIA returned no usable content");
    }

    console.log("NEMOTRON RAW RESPONSE:");
    console.log(content);

    const decisions = parseAiDecisions(content);

    console.log(
      "NEMOTRON DECISIONS:",
      JSON.stringify(decisions, null, 2)
    );

    return decisions;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    // Return cached news if still fresh
    if (cachedNews && Date.now() - cachedAt < CACHE_MS) {
      return NextResponse.json(cachedNews);
    }

    // Prevent multiple simultaneous AI requests
    if (inFlight) {
      return NextResponse.json(await inFlight);
    }

    inFlight = (async () => {
      // Fetch all four RSS feeds simultaneously
      const results = await Promise.allSettled(
        (Object.keys(FEEDS) as Category[]).map((category) =>
          getFeed(category)
        )
      );

      const articles = results.flatMap((result) => {
        if (result.status === "fulfilled") {
          return result.value;
        }

        console.error("NEWS FEED FAILED:", result.reason);

        return [];
      });

      if (articles.length === 0) {
        throw new Error("All news feeds are unavailable");
      }

      console.log("ARTICLES RECEIVED:", articles.length);

      // Ask Nemotron to filter and summarize
      const decisions = await withTimeout(
        filterAndSummarize(articles),
        65000
      );

      console.log("DECISIONS RECEIVED:", decisions.length);

      // Build map:
      // article index -> summary
      const approved = new Map<number, { summary: string; details: string }>();

      for (const decision of decisions) {
        if (
          decision.keep &&
          decision.summary.trim() &&
          decision.index >= 0 &&
          decision.index < articles.length
        ) {
          approved.set(decision.index, {
            summary: limitWords(decision.summary, 30),
            details: limitWords(
              decision.details || articles[decision.index].context,
              150
            ),
          });
        }
      }

      // Enforce category coverage even if the model ignores the instruction.
      // A category can only be included when its RSS feed returned an article.
      for (const category of Object.keys(FEEDS) as Category[]) {
        const categoryArticleIndex = articles.findIndex(
          (article) => article.category === category
        );

        const hasApprovedArticle = articles.some(
          (article, index) =>
            article.category === category && approved.has(index)
        );

        if (categoryArticleIndex !== -1 && !hasApprovedArticle) {
          const article = articles[categoryArticleIndex];

          approved.set(categoryArticleIndex, {
            summary: limitWords(article.title, 30),
            details: limitWords(
              article.context || article.title,
              150
            ),
          });
        }
      }

      console.log(
        "APPROVED INDICES:",
        Array.from(approved.keys())
      );

      // Construct final news list
      const news = articles.flatMap((article, index) => {
        const approvedArticle = approved.get(index);

        if (!approvedArticle) {
          return [];
        }

        return [
          {
            ...article,
            title: approvedArticle.summary,
            details: approvedArticle.details,
          },
        ];
      });

      console.log("FINAL NEWS COUNT:", news.length);

      cachedNews = news;
      cachedAt = Date.now();

      return news;
    })();

    return NextResponse.json(await inFlight);
  } catch (error) {
    console.error("NEWS ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process news",
      },
      {
        status: 502,
      }
    );
  } finally {
    inFlight = null;
  }
}
