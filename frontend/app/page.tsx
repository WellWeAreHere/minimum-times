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
  const [extremeMode, setExtremeMode] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState(
    sections.map((section) => section.key)
  );
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editionDate, setEditionDate] = useState("");
  const [loadedEditionDate, setLoadedEditionDate] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [dateError, setDateError] = useState("");

  function openEvent(event: NewsEvent) {
    setSelectedEvent((selected) =>
      selected?.id === event.id ? null : event
    );
  }

  function toggleCategory(category: string) {
    setVisibleCategories((current) =>
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
            {loadedEditionDate && (
              <p className={`${darkMode ? "text-gray-500" : "text-gray-500"} mt-2 text-xs uppercase tracking-wide`}>
                {formatEditionDate(loadedEditionDate)}
              </p>
            )}
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setDarkMode((value) => !value)}
                className={`border px-3 py-2 text-xs font-semibold ${
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
                className={`border px-3 py-2 text-xs font-semibold ${
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
            className={`border px-3 py-2 text-sm ${
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

          <div className="relative ml-auto">
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
                className={`absolute right-0 z-10 mt-2 w-72 border p-4 shadow-lg ${
                  darkMode
                    ? "border-gray-700 bg-black"
                    : "border-gray-300 bg-white"
                }`}
              >
                <p className="mb-3 text-xs font-semibold text-gray-500">
                  VISIBLE CATEGORIES
                </p>
                <div className="space-y-3">
                  {sections.map((section) => (
                    <label
                      key={section.key}
                      className="flex items-center gap-3 text-sm"
                    >
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
                    onClick={() => setVisibleCategories(sections.map((section) => section.key))}
                    className="underline"
                  >
                    SELECT ALL
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleCategories([]);
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
                    {section.label}
                  </h3>

                  {events.length === 0 ? (
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
                            {Object.keys(event.facts).length > 0 && (
                              <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
                                {Object.entries(event.facts).map(([key, value]) => (
                                  <div key={key}>
                                    <dt className="font-semibold uppercase text-xs text-gray-500">{key.replaceAll("_", " ")}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                            <p className="mt-6">
                              <span className="text-gray-500">Sources:</span>{" "}
                              {event.sources.map((source, sourceIndex) => (
                                <span key={source}>
                                  {sourceIndex > 0 && ", "}
                                  <a
                                    href={source}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`${darkMode ? "text-blue-400" : "text-blue-700"} underline`}
                                  >
                                    {sourceIndex + 1}
                                  </a>
                                </span>
                              ))}
                            </p>
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
          <span>Ideas, features, or issues?</span>{" "}
          <a
            href="mailto:iamherebcozidontknow@gmail.com?subject=Idea%20for%20Minimum%20Times"
            className="underline hover:text-current"
          >
            IDEA
          </a>{" "}
          <a
            href="mailto:iamherebcozidontknow@gmail.com?subject=Feature%20request%20for%20Minimum%20Times"
            className="underline hover:text-current"
          >
            FEATURE
          </a>{" "}
          <a
            href="mailto:iamherebcozidontknow@gmail.com?subject=Issue%20with%20Minimum%20Times"
            className="underline hover:text-current"
          >
            ISSUE
          </a>
        </footer>
      </div>
    </main>
  );
}
