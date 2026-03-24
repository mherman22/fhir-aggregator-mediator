'use strict';

const logger = console;

function mergeResults(results, sources) {
  const entries = [];
  let totalCount = 0;
  const nextPages = {};

  for (let i = 0; i < results.length; i++) {
    const bundle = results[i];
    if (!bundle) continue;

    const source = sources[i];
    const bundleEntries = bundle.entry || [];
    entries.push(...bundleEntries);
    totalCount += bundle.total || bundleEntries.length;

    const nextLink = (bundle.link || []).find((l) => l.relation === 'next');
    if (nextLink) {
      nextPages[source.id] = nextLink.url;
    }
  }

  // Deduplicate entries by resourceType/id — shared database clones produce
  // identical resources (e.g. Practitioners, Locations) across instances
  const seen = new Set();
  const dedupedEntries = entries.filter((entry) => {
    if (!entry.resource || !entry.resource.id) return true;
    const key = `${entry.resource.resourceType}/${entry.resource.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { entries: dedupedEntries, totalCount, nextPages };
}

async function searchAll(path, queryParams, sources, fhirClient) {
  const promises = sources.map((source) =>
    fhirClient
      .search(source, path, queryParams)
      .catch((err) => {
        logger.error(
          `[aggregator] Source ${source.id} (${source.name}) failed: ${err.message}`
        );
        return null;
      })
  );

  const results = await Promise.all(promises);
  return mergeResults(results, sources);
}

async function fetchNextPages(state, sources, fhirClient) {
  const activeSources = sources.filter((s) => state[s.id]);
  const promises = activeSources.map((source) =>
    fhirClient
      .fetchUrl(source, state[source.id])
      .catch((err) => {
        logger.error(
          `[aggregator] Pagination fetch from ${source.id} failed: ${err.message}`
        );
        return null;
      })
  );

  const results = await Promise.all(promises);
  return mergeResults(results, activeSources);
}

module.exports = { searchAll, fetchNextPages, mergeResults };
