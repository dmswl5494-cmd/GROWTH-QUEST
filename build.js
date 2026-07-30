// Bundle script generator for Growth Quest single-page application Architecture
const fs = require('fs');
const path = require('path');

const srcFiles = [
  'models.ts',
  'repository.ts',
  'services.ts',
  'components.ts',
  'main.ts'
];

console.log('Building standalone executable JS bundle for Growth Quest...');
