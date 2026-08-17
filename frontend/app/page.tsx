"use client";

import { useEffect, useState } from "react";

type Article = {
  title: string;
  microSummary: string;
  url: string;
  published: string;
  category: string;
  scope: string;
  details: string;
};

const sections = [
  { key: "politics", label: "POLITICS" },
  { key: "sports", label: "SPORTS" },
  { key: "entertainment", label: "ENTERTAINMENT" },
  { key: "tragedies", label: "TRAGEDIES" },
];

const scopes = [
  { key: "national", label: "NATIONAL — INDIA" },
  { key: "international", label: "INTERNATIONAL" },
];

export default function Home() {
  const [news, setNews] = useState<Article[] | null>(null);
  const [error, setError] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [selectedScope, setSelectedScope] = useState("national");
  const [extremeMode, setExtremeMode] = useState(false);

  function openArticle(article: Article) {
    setSelectedArticle((selected) =>
      selected?.url === article.url ? null : article
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadEdition() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch("/api/edition/today", {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Edition unavailable");
        if (!Array.isArray(data)) throw new Error("Edition has an invalid format");

        if (!cancelled) setNews(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load today’s edition"
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    loadEdition();
    const refresh = setInterval(loadEdition, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, []);

  const theme = darkMode
    ? "bg-black text-white"
    : "bg-white text-black";

  if (news === null && !error) {
    return (
      <main className={`min-h-screen flex items-center justify-center ${theme}`}>
        <p className="text-gray-500">Loading today’s edition...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={`min-h-screen flex items-center justify-center px-6 ${theme}`}>
        <div className="text-center">
          <h1 className="text-2xl font-bold">Today’s edition is unavailable</h1>
          <p className="text-red-400 mt-3">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen ${theme}`}>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="mb-14">
          <h1 className="text-5xl font-bold tracking-tight">MINIMUM TIMES</h1>
          <div className="flex items-center justify-between gap-6">
            <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} mt-2`}>
              The minimum news you need.
            </p>
            <button
              type="button"
              onClick={() => setDarkMode((value) => !value)}
              className={`shrink-0 border px-3 py-2 text-xs font-semibold ${
                darkMode
                  ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {darkMode ? "LIGHT MODE" : "DARK MODE"}
            </button>
            <button
              type="button"
              onClick={() => setExtremeMode((value) => !value)}
              className={`shrink-0 border px-3 py-2 text-xs font-semibold ${
                extremeMode
                  ? darkMode
                    ? "border-white bg-white text-black"
                    : "border-black bg-black text-white"
                  : darkMode
                    ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {extremeMode ? "NORMAL MODE" : "EXTREME MODE"}
            </button>
          </div>
        </header>

        <div className="flex gap-2 mb-10" role="tablist" aria-label="Edition scope">
          {scopes.map((scope) => {
            const isSelected = selectedScope === scope.key;
            return (
              <button
                key={scope.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setSelectedScope(scope.key);
                  setSelectedArticle(null);
                }}
                className={`border px-4 py-2 text-sm font-semibold transition ${
                  isSelected
                    ? darkMode
                      ? "border-white bg-white text-black"
                      : "border-black bg-black text-white"
                    : darkMode
                      ? "border-gray-700 text-gray-400 hover:border-gray-400"
                      : "border-gray-300 text-gray-600 hover:border-gray-600"
                }`}
              >
                {scope.label}
              </button>
            );
          })}
        </div>

        {scopes.filter((scope) => scope.key === selectedScope).map((scope) => (
          <section key={scope.key} className="mb-14">
            <h2 className="text-2xl font-bold border-b border-gray-700 pb-3 mb-6">
              {scope.label}
            </h2>

            {sections.map((section) => {
              const articles = news!.filter(
                (article) =>
                  article.scope === scope.key && article.category === section.key
              );

              return (
                <div key={`${scope.key}-${section.key}`} className="mb-10">
                  <h3 className="text-xl font-bold border-b border-gray-700 pb-3 mb-2">
                    {section.label}
                  </h3>

                  {articles.length === 0 ? (
                    <p className="text-gray-600 py-4">No major news.</p>
                  ) : (
                    articles.map((article, index) => (
                      <div key={`${article.url}-${index}`}>
                        <button
                          type="button"
                          onClick={() => openArticle(article)}
                          className={`block w-full text-left py-4 border-b transition ${
                            darkMode
                              ? "border-gray-900 hover:bg-gray-950"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <div className="text-lg leading-snug">
                            {extremeMode ? article.microSummary : article.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-2">
                            {article.published}
                          </div>
                        </button>

                        {selectedArticle?.url === article.url && (
                          <div
                            className={`border-b px-4 py-6 ${
                              darkMode
                                ? "border-gray-900 bg-gray-950"
                                : "border-gray-200 bg-gray-50"
                            }`}
                          >
                            <p className="text-gray-500 text-sm mb-3">
                              Extended summary
                            </p>
                            <p
                              className={`${darkMode ? "text-gray-300" : "text-gray-700"} leading-7 whitespace-pre-wrap`}
                            >
                              {article.details}
                            </p>
                            <p className="mt-6">
                              <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${darkMode ? "text-blue-400" : "text-blue-700"} underline`}
                              >
                                Read the full article →
                              </a>
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </main>
  );
}
