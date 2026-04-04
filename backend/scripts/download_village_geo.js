const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Script to pre-download village GeoJSON files for offline caching.
 * Usage: node download_village_geo.js <villageCode1> <villageCode2> ...
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const GEO_DATA_DIR = path.join(__dirname, '..', 'geo_data');

if (!fs.existsSync(GEO_DATA_DIR)) {
  fs.mkdirSync(GEO_DATA_DIR, { recursive: true });
}

async function downloadVillage(villageCode) {
  const url = `${BASE_URL}/geo/khasra/${villageCode}`;
  const filePath = path.join(GEO_DATA_DIR, `${villageCode}.geojson`);

  console.log(`Downloading ${villageCode} from ${url}...`);
  try {
    const response = await axios.get(url);
    fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
    console.log(`Successfully saved to ${filePath}`);
  } catch (error) {
    console.error(`Failed to download ${villageCode}:`, error.message);
  }
}

const villageCodes = process.argv.slice(2);

if (villageCodes.length === 0) {
  console.log('Usage: node download_village_geo.js <villageCode1> <villageCode2> ...');
  process.exit(1);
}

// Download all provided village codes
(async () => {
  for (const code of villageCodes) {
    await downloadVillage(code);
  }
})();
