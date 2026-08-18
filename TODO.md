# TODO

- [x] Add a second Nemotron deduplication pass after article selection, immediately before publishing/rendering the website edition, so duplicate stories that survive the initial fetch-time deduplication are removed from the final visible articles.
- [x] Ensure game-related sports news always includes the score in the displayed summary when available (for example, India vs Bangladesh: 110/8 and 100/7).
- [x] Reduce the final Nemotron keep/discard review batch size from 5 articles to 3 articles per request.
- [ ] Decide whether to reduce the current 6,000-character article-text limit.
- [x] Create category-specific Nemotron review prompts: require scores and match status for sports, concrete impact numbers and locations for tragedies, specific decisions or rulings for politics, and verified releases/earnings/announcements for entertainment; reject vague or promotional summaries when precise facts are available.
