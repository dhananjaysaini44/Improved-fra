const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'fra_atlas.db');
const db = new Database(dbPath);

console.log('Seeding location hierarchy...');

const seedData = [
  // Madhya Pradesh - Mandla District
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03816', 'Niwas', '495392', 'Ghughri'],
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03816', 'Niwas', '495393', 'Bamhni'],
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03817', 'Mandla', '495444', 'Sijhora'],
  // Madhya Pradesh - Dindori District
  ['MP', 'Madhya Pradesh', '454', 'Dindori', '03818', 'Dindori', '495555', 'Samnapur'],

  // Odisha - Koraput District
  ['OR', 'Odisha', '396', 'Koraput', '03287', 'Jeypore', '428512', 'Kundra'],
  ['OR', 'Odisha', '396', 'Koraput', '03287', 'Jeypore', '428513', 'Borigumma'],
  ['OR', 'Odisha', '396', 'Koraput', '03288', 'Koraput', '428600', 'Sunabeda'],
  // Odisha - Kandhamal District
  ['OR', 'Odisha', '389', 'Kandhamal', '03100', 'Phulbani', '421000', 'Daringbadi'],

  // Tripura - West Tripura District
  ['TR', 'Tripura', '461', 'West Tripura', '03924', 'Mohanpur', '502311', 'Champaknagar'],
  ['TR', 'Tripura', '461', 'West Tripura', '03924', 'Mohanpur', '502312', 'Melaghar'],
  ['TR', 'Tripura', '461', 'West Tripura', '03925', 'Jirania', '502400', 'Khowai'],

  // Telangana - Bhadradri Kothagudem District
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04601', 'Bhadrachalam', '574211', 'Kinnerasani'],
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04601', 'Bhadrachalam', '574212', 'Paloncha'],
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04602', 'Kothagudem', '574300', 'Yellandu'],
  // Telangana - Adilabad District
  ['TS', 'Telangana', '532', 'Adilabad', '04500', 'Utnoor', '570000', 'Indervelly']
];

const insertLocation = db.prepare(`
  INSERT OR IGNORE INTO location_hierarchy 
  (state_code, state_name, district_code, district_name, tehsil_code, tehsil_name, village_code, village_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const row of seedData) {
    insertLocation.run(...row);
  }
})();

console.log('Seeding complete. Added/Verified', seedData.length, 'records.');
const count = db.prepare('SELECT COUNT(*) as count FROM location_hierarchy').get().count;
console.log('Total records in location_hierarchy:', count);
