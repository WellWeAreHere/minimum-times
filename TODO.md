# TODO

- [ ] Change the news pipeline to fetch articles, run keep/discard first, then deduplicate only the small approved set; remove the earlier AI deduplication pass.
- [ ] Diagnose NVIDIA request failures with detailed response logging and reduce unnecessary AI requests through local deduplication, smaller feed batches, and limited retries.
- [x] Add an Ideas / Features / Issues contact option that opens an email to iamherebcozidontknow@gmail.com.
- [x] Add date-based access to previous editions, allowing users to browse an edition by its date.
- [x] Add a client-side CATEGORIES menu beside the scope tabs, with accessible checkbox toggles, all categories selected by default, and Select all/Clear all actions.
- [x] Add Business and Science & Technology to the news categories.
- [x] When asking AI whether to keep an article, do not include the headline; use the article text only.
- [x] Remove the unused article-fetch endpoint; if it is reintroduced, restrict it to trusted domains and block private/internal addresses to prevent SSRF.
- [x] Add a second Nemotron deduplication pass after article selection, immediately before publishing/rendering the website edition, so duplicate stories that survive the initial fetch-time deduplication are removed from the final visible articles.
- [x] Ensure game-related sports news always includes the score in the displayed summary when available (for example, India vs Bangladesh: 110/8 and 100/7).
- [x] Reduce the final Nemotron keep/discard review batch size from 5 articles to 3 articles per request.
- [x] Keep the current 6,000-character article-text limit; it provides enough context for review while controlling prompt size.
- [x] Create category-specific Nemotron review prompts: require scores and match status for sports, concrete impact numbers and locations for tragedies, specific decisions or rulings for politics, and verified releases/earnings/announcements for entertainment; reject vague or promotional summaries when precise facts are available.
