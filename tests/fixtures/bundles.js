'use strict';

function makeBundle(entries, total, nextUrl) {
  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: total != null ? total : entries.length,
    entry: entries.map((e) => ({
      fullUrl: `http://test/fhir/${e.resourceType}/${e.id}`,
      resource: e,
    })),
    link: [{ relation: 'self', url: 'http://test/fhir/Patient?_count=20' }],
  };
  if (nextUrl) {
    bundle.link.push({ relation: 'next', url: nextUrl });
  }
  return bundle;
}

const patient1 = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Smith' }] };
const patient2 = { resourceType: 'Patient', id: 'p2', name: [{ family: 'Jones' }] };
const patient3 = { resourceType: 'Patient', id: 'p3', name: [{ family: 'Brown' }] };

// Shared across cloned instances (same ID)
const practitioner1 = { resourceType: 'Practitioner', id: 'pr1', name: [{ family: 'Dr. A' }] };
const practitioner2 = { resourceType: 'Practitioner', id: 'pr2', name: [{ family: 'Dr. B' }] };

const location1 = { resourceType: 'Location', id: 'loc1', name: 'HUEH' };
const location2 = { resourceType: 'Location', id: 'loc2', name: 'La Paix' };

const source1Bundle = makeBundle([patient1, practitioner1, location1], 3);
const source2Bundle = makeBundle([patient2, practitioner1, location1], 3); // pr1 + loc1 are dupes
const source3Bundle = makeBundle([patient3, practitioner2], 2);
const emptyBundle = makeBundle([], 0);

const paginatedBundle1 = makeBundle(
  [location1, location2],
  100,
  'http://isanteplus:8080/openmrs/ws/fhir2/R4?_getpages=abc123&_getpagesoffset=20&_count=20'
);
const paginatedBundle2 = makeBundle(
  [location1],
  100,
  'http://isanteplus2:8080/openmrs/ws/fhir2/R4?_getpages=def456&_getpagesoffset=20&_count=20'
);

const testSources = [
  {
    id: 'src1',
    name: 'Source 1',
    baseUrl: 'http://src1:8080/fhir',
    username: 'admin',
    password: 'pass',
  },
  {
    id: 'src2',
    name: 'Source 2',
    baseUrl: 'http://src2:8080/fhir',
    username: 'admin',
    password: 'pass',
  },
  {
    id: 'src3',
    name: 'Source 3',
    baseUrl: 'http://src3:8080/fhir',
    username: 'admin',
    password: 'pass',
  },
];

const testConfig = {
  app: { port: 3000 },
  sources: testSources,
  pagination: { cacheMaxSize: 100, cacheTtlMs: 60000 },
};

module.exports = {
  makeBundle,
  patient1,
  patient2,
  patient3,
  practitioner1,
  practitioner2,
  location1,
  location2,
  source1Bundle,
  source2Bundle,
  source3Bundle,
  emptyBundle,
  paginatedBundle1,
  paginatedBundle2,
  testSources,
  testConfig,
};
