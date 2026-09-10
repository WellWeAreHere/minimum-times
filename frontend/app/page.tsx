"use client";

import { useEffect, useState } from "react";
import type { NewsEvent } from "../types/event";

const sections = [
  { key: "politics", label: "POLITICS" },
  { key: "sports", label: "SPORTS" },
  { key: "business", label: "BUSINESS" },
  { key: "science", label: "SCIENCE & TECHNOLOGY" },
  { key: "entertainment", label: "ENTERTAINMENT" },
  { key: "tragedies", label: "TRAGEDIES" },
];

const scopes = [
  { key: "national", label: "NATIONAL — INDIA" },
  { key: "international", label: "INTERNATIONAL" },
];

const CATEGORY_PREFERENCE_KEY = "minimum-times-visible-categories";
const EXTREME_MODE_PREFERENCE_KEY = "minimum-times-extreme-mode";
const TEXT_SCALE_PREFERENCE_KEY = "minimum-times-text-scale";
const DEFAULT_TEXT_SCALE = 1;
const MIN_TEXT_SCALE = 0.85;
const MAX_TEXT_SCALE = 1.3;
const TEXT_SCALE_DECREASE_STEP = 0.15;
const TEXT_SCALE_INCREASE_STEP = 0.1;

function formatEditionDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
  return `${weekday}, ${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`;
}

export default function Home() {
  const [news, setNews] = useState<NewsEvent[] | null>(null);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<NewsEvent | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [selectedScope, setSelectedScope] = useState("national");
  const [extremeMode, setExtremeMode] = useState(true);
  const [textScale, setTextScale] = useState(DEFAULT_TEXT_SCALE);
  const [visibleCategories, setVisibleCategories] = useState(
    sections.map((section) => section.key)
  );
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editionDate, setEditionDate] = useState("");
  const [loadedEditionDate, setLoadedEditionDate] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    const restoreCategories = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CATEGORY_PREFERENCE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setVisibleCategories(
            sections.map((section) => section.key).filter((key) => parsed.includes(key))
          );
        }
      } catch {
        // Ignore unavailable or malformed browser storage.
      }
    }, 0);

    return () => window.clearTimeout(restoreCategories);
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${textScale * 100}%`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [textScale]);

  useEffect(() => {
    const restorePreferences = window.setTimeout(() => {
      try {
        const storedExtremeMode = window.localStorage.getItem(EXTREME_MODE_PREFERENCE_KEY);
        if (storedExtremeMode !== null) setExtremeMode(storedExtremeMode === "true");

        const storedTextScale = Number(window.localStorage.getItem(TEXT_SCALE_PREFERENCE_KEY));
        if (Number.isFinite(storedTextScale)) {
          setTextScale(Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, storedTextScale)));
        }
      } catch {
        // Ignore unavailable or malformed browser storage.
      }
    }, 0);

    return () => window.clearTimeout(restorePreferences);
  }, []);

  function updateTextScale(nextScale: number) {
    const next = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, nextScale));
    setTextScale(next);
    try {
      window.localStorage.setItem(TEXT_SCALE_PREFERENCE_KEY, String(next));
    } catch {
      // Ignore unavailable browser storage.
    }
  }

  function toggleExtremeMode() {
    setExtremeMode((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(EXTREME_MODE_PREFERENCE_KEY, String(next));
      } catch {
        // Ignore unavailable browser storage.
      }
      return next;
    });
  }

  function openEvent(event: NewsEvent) {
    setSelectedEvent((selected) =>
      selected?.id === event.id ? null : event
    );
  }

  function toggleCategory(category: string) {
    setVisibleCategories((current) => {
      const next = current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category];
      try {
        window.localStorage.setItem(CATEGORY_PREFERENCE_KEY, JSON.stringify(next));
      } catch {
        // Ignore unavailable browser storage.
      }
      return next;
    });
    setSelectedEvent(null);
  }

  function toggleCollapsedCategory(category: string) {
    setCollapsedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    );
    setSelectedEvent(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadEdition() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const endpoint = editionDate
          ? `/api/edition/today?date=${encodeURIComponent(editionDate)}`
          : "/api/edition/today";
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Edition unavailable");
        if (!data || !Array.isArray(data.events) || typeof data.editionDate !== "string") {
          throw new Error("Edition has an invalid format");
        }

        if (!cancelled) {
          setNews(data.events);
          setLoadedEditionDate(data.editionDate);
          setError("");
        }
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
  }, [editionDate]);

  const theme = darkMode
    ? "bg-black text-white"
    : "bg-white text-black";
  const editionDescription = editionDate ? formatEditionDate(editionDate) : "today’s edition";

  if (news === null && !error) {
    return (
      <main className={`min-h-screen flex items-center justify-center ${theme}`}>
        <p className="text-gray-500">Loading {editionDescription}...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={`min-h-screen flex items-center justify-center px-6 ${theme}`}>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{editionDescription} is unavailable</h1>
          <p className="text-red-400 mt-3">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen overflow-x-hidden ${theme}`}>
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-14">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">MINIMUM TIMES</h1>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} mt-2`}>
                The minimum news you need.
              </p>
              {loadedEditionDate && (
                <p className={`${darkMode ? "text-gray-500" : "text-gray-500"} mt-2 text-xs uppercase tracking-wide`}>
                  {formatEditionDate(loadedEditionDate)}
                </p>
              )}
            </div>
            <div className="flex max-w-full flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDarkMode((value) => !value)}
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                className={`min-h-11 min-w-11 border px-3 py-2 text-lg leading-none transition ${
                  darkMode
                    ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                {darkMode ? "☾" : "☀"}
              </button>
              <button
                type="button"
                onClick={toggleExtremeMode}
                aria-label={extremeMode ? "Switch to normal summaries" : "Switch to extreme summaries"}
                title={extremeMode ? "Switch to normal summaries" : "Switch to extreme summaries"}
                className={`min-h-11 min-w-11 border px-3 py-2 text-lg leading-none transition ${
                  extremeMode
                    ? darkMode
                      ? "border-white bg-white text-black"
                      : "border-black bg-black text-white"
                    : darkMode
                      ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                ⚡
              </button>
              <button
                type="button"
                onClick={() => updateTextScale(textScale - TEXT_SCALE_DECREASE_STEP)}
                disabled={textScale <= MIN_TEXT_SCALE}
                aria-label="Decrease text size"
                title="Decrease text size"
                className={`min-h-11 min-w-11 border px-3 py-2 text-sm font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode
                    ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => updateTextScale(textScale + TEXT_SCALE_INCREASE_STEP)}
                disabled={textScale >= MAX_TEXT_SCALE}
                aria-label="Increase text size"
                title="Increase text size"
                className={`min-h-11 min-w-11 border px-3 py-2 text-sm font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode
                    ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                A+
              </button>
              <button
                type="button"
                onClick={() => updateTextScale(DEFAULT_TEXT_SCALE)}
                disabled={textScale === DEFAULT_TEXT_SCALE}
                aria-label="Reset text size"
                title="Reset text size"
                className={`min-h-11 border px-3 py-2 text-xs font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode
                    ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                RESET
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 mb-10" role="tablist" aria-label="Edition scope">
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
                  setSelectedEvent(null);
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
          <div className="relative">
            <button
              type="button"
              onClick={() => setCategoriesOpen((value) => !value)}
              aria-expanded={categoriesOpen}
              aria-controls="category-menu"
              className={`border px-3 py-2 text-xs font-semibold ${
                darkMode
                  ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              CATEGORIES {categoriesOpen ? "▲" : "▼"}
            </button>
            {categoriesOpen && (
              <div
                id="category-menu"
                className={`absolute left-0 z-10 mt-2 w-72 border p-4 shadow-lg ${
                  darkMode ? "border-gray-700 bg-black" : "border-gray-300 bg-white"
                }`}
              >
                <p className="mb-3 text-xs font-semibold text-gray-500">VISIBLE CATEGORIES</p>
                <div className="space-y-3">
                  {sections.map((section) => (
                    <label key={section.key} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={visibleCategories.includes(section.key)}
                        onChange={() => toggleCategory(section.key)}
                      />
                      {section.label}
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      const next = sections.map((section) => section.key);
                      setVisibleCategories(next);
                      try {
                        window.localStorage.setItem(CATEGORY_PREFERENCE_KEY, JSON.stringify(next));
                      } catch {
                        // Ignore unavailable browser storage.
                      }
                    }}
                    className="underline"
                  >
                    SELECT ALL
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleCategories([]);
                      try {
                        window.localStorage.setItem(CATEGORY_PREFERENCE_KEY, JSON.stringify([]));
                      } catch {
                        // Ignore unavailable browser storage.
                      }
                      setSelectedEvent(null);
                    }}
                    className="underline"
                  >
                    CLEAR ALL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-10">
          <label htmlFor="edition-date" className="text-sm font-semibold">
            EDITION DATE
          </label>
          <input
            id="edition-date"
            type="date"
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
            className={`border px-3 py-2 text-sm [color-scheme:light] ${
              darkMode
                ? "border-gray-700 bg-black text-white"
                : "border-gray-300 bg-white text-black"
            }`}
          />
          <button
            type="button"
            onClick={() => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                setDateError("Enter a complete edition date");
                return;
              }

              setDateError("");
              setEditionDate(dateInput);
              setSelectedEvent(null);
              setNews(null);
            }}
            className={`border px-3 py-2 text-xs font-semibold ${
              darkMode
                ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                : "border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            LOAD EDITION
          </button>
          {dateError && <span className="text-xs text-red-400">{dateError}</span>}
          {editionDate && (
            <button
              type="button"
              onClick={() => {
                setEditionDate("");
                setDateInput("");
                setDateError("");
                setSelectedEvent(null);
                setNews(null);
              }}
              className={`border px-3 py-2 text-xs font-semibold ${
                darkMode
                  ? "border-gray-700 text-gray-300 hover:bg-gray-900"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              LATEST EDITION
            </button>
          )}

        </div>

        {scopes.filter((scope) => scope.key === selectedScope).map((scope) => (
          <section key={scope.key} className="mb-14">
            <h2 className="text-2xl font-bold border-b border-gray-700 pb-3 mb-6">
              {scope.label}
            </h2>

            {sections.filter((section) => visibleCategories.includes(section.key)).map((section) => {
              const events = news!.filter(
                (event) =>
                  event.scope === scope.key && event.category === section.key
              );

              return (
                <div key={`${scope.key}-${section.key}`} className="mb-10">
                  <h3 className="text-xl font-bold border-b border-gray-700 pb-3 mb-2">
                    <button
                      type="button"
                      aria-expanded={!collapsedCategories.includes(section.key)}
                      onClick={() => toggleCollapsedCategory(section.key)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span>{section.label}</span>
                      <span aria-hidden="true">{collapsedCategories.includes(section.key) ? "＋" : "−"}</span>
                    </button>
                  </h3>

                  {collapsedCategories.includes(section.key) ? null : events.length === 0 ? (
                    <p className="text-gray-600 py-4">No major news.</p>
                  ) : (
                    events.map((event) => (
                      <div key={event.id}>
                        <button
                          type="button"
                          onClick={() => openEvent(event)}
                          className={`block w-full text-left py-4 border-b transition ${
                            darkMode
                              ? "border-gray-900 hover:bg-gray-950"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <div className="text-lg leading-snug">
                            {extremeMode ? event.microSummary : event.summary}
                          </div>
                          <div className="text-xs text-gray-500 mt-2">
                            {event.timestamp}
                          </div>
                        </button>

                        {selectedEvent?.id === event.id && (
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
                              {event.details}
                            </p>
                            {event.sources.length > 0 && (
                              <div className="mt-5 border-t border-gray-800 pt-4 text-sm">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  Source articles
                                </p>
                                <ul className="space-y-1">
                                  {event.sources.map((source, index) => (
                                    <li key={`${event.id}-source-${index}`}>
                                      <a href={source} target="_blank" rel="noreferrer" className="underline hover:text-current">
                                        Read source {index + 1}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
            {visibleCategories.length === 0 && (
              <p className="py-4 text-gray-500">
                Select at least one category to view the edition.
              </p>
            )}
          </section>
        ))}

        <footer
          className={`border-t pt-6 text-sm ${
            darkMode ? "border-gray-800 text-gray-500" : "border-gray-200 text-gray-600"
          }`}
        >
          <span>Ideas, issues, or suggestions?</span>{" "}
          <a
            href="mailto:iamherebcozidontknow@gmail.com?subject=Feedback%20for%20Minimum%20Times"
            className="underline hover:text-current"
          >
            → Email us
          </a>
        </footer>
      </div>
    </main>
  );
}
