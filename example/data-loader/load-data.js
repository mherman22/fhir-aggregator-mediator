#!/usr/bin/env node

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// FHIR server URLs from environment
const facilityUrls = {
  A: process.env.FACILITY_A_URL || 'http://localhost:8081/fhir',
  B: process.env.FACILITY_B_URL || 'http://localhost:8082/fhir',
  C: process.env.FACILITY_C_URL || 'http://localhost:8083/fhir'
};

console.log('FHIR Aggregator Data Loader');
console.log('============================');
console.log('Facility URLs:');
Object.entries(facilityUrls).forEach(([key, url]) => {
  console.log(`  Facility ${key}: ${url}`);
});

// Sample data generators
function generatePatient(facilityId, patientIndex) {
  const facilityNames = {
    A: 'General Hospital',
    B: 'Community Clinic',
    C: 'Rural Health Center'
  };

  const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Lisa', 'Robert', 'Maria', 'James', 'Anna'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore'];

  return {
    resourceType: 'Patient',
    id: `patient-${facilityId.toLowerCase()}-${patientIndex}`,
    meta: {
      source: facilityNames[facilityId],
      tag: [
        {
          system: 'http://example.org/facility',
          code: facilityId,
          display: facilityNames[facilityId]
        }
      ]
    },
    identifier: [
      {
        use: 'usual',
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MR',
              display: 'Medical Record Number'
            }
          ]
        },
        system: `http://facility-${facilityId.toLowerCase()}.example.org/patient-id`,
        value: `MRN-${facilityId}-${String(patientIndex).padStart(4, '0')}`
      }
    ],
    active: true,
    name: [
      {
        use: 'official',
        family: lastNames[patientIndex % lastNames.length],
        given: [firstNames[patientIndex % firstNames.length]]
      }
    ],
    telecom: [
      {
        system: 'phone',
        value: `+1-555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        use: 'mobile'
      },
      {
        system: 'email',
        value: `patient${patientIndex}@facility${facilityId.toLowerCase()}.example.org`,
        use: 'home'
      }
    ],
    gender: patientIndex % 2 === 0 ? 'male' : 'female',
    birthDate: `${1950 + (patientIndex % 50)}-${String((patientIndex % 12) + 1).padStart(2, '0')}-${String((patientIndex % 28) + 1).padStart(2, '0')}`,
    address: [
      {
        use: 'home',
        line: [`${100 + patientIndex} Main Street`],
        city: `City${facilityId}`,
        state: 'State',
        postalCode: `${10000 + patientIndex}`,
        country: 'US'
      }
    ]
  };
}

function generateEncounter(facilityId, patientId, encounterIndex) {
  const encounterTypes = [
    { code: 'AMB', display: 'Ambulatory' },
    { code: 'EMER', display: 'Emergency' },
    { code: 'IMP', display: 'Inpatient' },
    { code: 'SS', display: 'Short Stay' }
  ];

  const type = encounterTypes[encounterIndex % encounterTypes.length];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (encounterIndex * 7)); // Weekly encounters going back in time

  return {
    resourceType: 'Encounter',
    id: `encounter-${facilityId.toLowerCase()}-${encounterIndex}`,
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: type.code,
      display: type.display
    },
    type: [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: '185349003',
            display: 'Encounter for check up'
          }
        ]
      }
    ],
    subject: {
      reference: `Patient/${patientId}`
    },
    period: {
      start: startDate.toISOString().split('T')[0],
      end: startDate.toISOString().split('T')[0]
    }
  };
}

function generateObservation(facilityId, patientId, encounterId, observationIndex) {
  const vitalSigns = [
    { code: '8480-6', display: 'Systolic blood pressure', unit: 'mmHg', value: () => 110 + Math.floor(Math.random() * 40) },
    { code: '8462-4', display: 'Diastolic blood pressure', unit: 'mmHg', value: () => 70 + Math.floor(Math.random() * 20) },
    { code: '8867-4', display: 'Heart rate', unit: '/min', value: () => 60 + Math.floor(Math.random() * 40) },
    { code: '8310-5', display: 'Body temperature', unit: 'Cel', value: () => 36.5 + Math.random() * 2 },
    { code: '29463-7', display: 'Body weight', unit: 'kg', value: () => 60 + Math.floor(Math.random() * 40) }
  ];

  const vital = vitalSigns[observationIndex % vitalSigns.length];

  return {
    resourceType: 'Observation',
    id: `observation-${facilityId.toLowerCase()}-${observationIndex}`,
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs'
          }
        ]
      }
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: vital.code,
          display: vital.display
        }
      ]
    },
    subject: {
      reference: `Patient/${patientId}`
    },
    encounter: {
      reference: `Encounter/${encounterId}`
    },
    effectiveDateTime: new Date().toISOString(),
    valueQuantity: {
      value: vital.value(),
      unit: vital.unit,
      system: 'http://unitsofmeasure.org',
      code: vital.unit
    }
  };
}

function generateCondition(facilityId, patientId, conditionIndex) {
  const conditions = [
    { code: 'E11', display: 'Type 2 diabetes mellitus' },
    { code: 'I10', display: 'Essential hypertension' },
    { code: 'J44', display: 'Chronic obstructive pulmonary disease' },
    { code: 'M79.3', display: 'Panniculitis, unspecified' },
    { code: 'Z51.11', display: 'Encounter for antineoplastic chemotherapy' }
  ];

  const condition = conditions[conditionIndex % conditions.length];

  return {
    resourceType: 'Condition',
    id: `condition-${facilityId.toLowerCase()}-${conditionIndex}`,
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active'
        }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed'
        }
      ]
    },
    code: {
      coding: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10',
          code: condition.code,
          display: condition.display
        }
      ]
    },
    subject: {
      reference: `Patient/${patientId}`
    },
    onsetDateTime: new Date(Date.now() - Math.floor(Math.random() * 365) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  };
}

// Upsert FHIR resources with retry logic (PUT when id is provided, POST otherwise)
async function upsertResource(baseUrl, resource, retries = 3) {
  const resourceTypeUrl = `${baseUrl}/${resource.resourceType}`;
  const resourceUrl = resource.id ? `${resourceTypeUrl}/${resource.id}` : resourceTypeUrl;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const method = resource.id ? 'put' : 'post';
      const response = await axios({
        method,
        url: resourceUrl,
        data: resource,
        headers: {
          'Content-Type': 'application/fhir+json'
        },
        timeout: 10000
      });
      return response;
    } catch (error) {
      console.warn(`  Attempt ${attempt}/${retries} failed for ${resource.resourceType}/${resource.id}: ${error.message}`);
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
    }
  }
}

// Main data loading function
async function loadDataToFacility(facilityId, baseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  console.log(`\nLoading data to Facility ${facilityId} (${normalizedBaseUrl})`);
  console.log('='.repeat(50));

  const resourceCounts = {
    Patient: 0,
    Encounter: 0,
    Observation: 0,
    Condition: 0
  };

  try {
    // Generate and post patients
    console.log('Creating patients...');
    const patientIds = [];
    for (let i = 1; i <= 10; i++) {
      const patient = generatePatient(facilityId, i);
      await upsertResource(normalizedBaseUrl, patient);
      patientIds.push(patient.id);
      resourceCounts.Patient++;
      process.stdout.write(`.`);
    }
    console.log(` ${resourceCounts.Patient} patients created`);

    // Generate encounters for each patient
    console.log('Creating encounters...');
    const encounterIds = [];
    for (let patientIndex = 0; patientIndex < patientIds.length; patientIndex++) {
      const patientId = patientIds[patientIndex];
      for (let e = 1; e <= 3; e++) {
        const encounter = generateEncounter(facilityId, patientId, patientIndex * 3 + e);
        await upsertResource(normalizedBaseUrl, encounter);
        encounterIds.push({ encounterId: encounter.id, patientId });
        resourceCounts.Encounter++;
        process.stdout.write(`.`);
      }
    }
    console.log(` ${resourceCounts.Encounter} encounters created`);

    // Generate observations
    console.log('Creating observations...');
    for (let i = 0; i < encounterIds.length; i++) {
      const { encounterId, patientId } = encounterIds[i];
      for (let o = 1; o <= 2; o++) {
        const observation = generateObservation(facilityId, patientId, encounterId, i * 2 + o);
        await upsertResource(normalizedBaseUrl, observation);
        resourceCounts.Observation++;
        process.stdout.write(`.`);
      }
    }
    console.log(` ${resourceCounts.Observation} observations created`);

    // Generate conditions
    console.log('Creating conditions...');
    for (let patientIndex = 0; patientIndex < patientIds.length; patientIndex++) {
      const patientId = patientIds[patientIndex];
      if (patientIndex % 2 === 0) { // Only some patients have conditions
        const condition = generateCondition(facilityId, patientId, patientIndex);
        await upsertResource(normalizedBaseUrl, condition);
        resourceCounts.Condition++;
        process.stdout.write(`.`);
      }
    }
    console.log(` ${resourceCounts.Condition} conditions created`);

    console.log(`\nFacility ${facilityId} summary:`);
    Object.entries(resourceCounts).forEach(([resourceType, count]) => {
      console.log(`  ${resourceType}: ${count} resources`);
    });

  } catch (error) {
    console.error(`\nError loading data to Facility ${facilityId}:`, error.message);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log('\n🚀 Starting data loading process...\n');

    // Load data to all facilities in parallel
    const loadPromises = Object.entries(facilityUrls).map(([facilityId, url]) =>
      loadDataToFacility(facilityId, url)
    );

    await Promise.all(loadPromises);

    console.log('\n✅ Data loading completed successfully!');
    console.log('\nYou can now test the aggregator by querying:');
    console.log('  http://localhost:3000/fhir/Patient');
    console.log('  http://localhost:3000/fhir/Encounter');
    console.log('  http://localhost:3000/fhir/Observation');
    console.log('  http://localhost:3000/fhir/Condition');
    console.log('\nAnd compare with individual facilities:');
    Object.entries(facilityUrls).forEach(([facilityId, url]) => {
      const port = url.includes('8081') ? '8081' : url.includes('8082') ? '8082' : '8083';
      console.log(`  Facility ${facilityId}: http://localhost:${port}/fhir/Patient`);
    });

  } catch (error) {
    console.error('\n❌ Data loading failed:', error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = {
  generatePatient,
  generateEncounter,
  generateObservation,
  generateCondition,
  loadDataToFacility
};
