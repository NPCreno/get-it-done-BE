import { writeFileSync } from 'fs';
import { join } from 'path';
import { API_CONTRACT } from '../src/common/api-contract';

const target = join(__dirname, '..', 'docs', 'api-contract.json');
writeFileSync(target, JSON.stringify(API_CONTRACT, null, 2) + '\n', 'utf8');
console.log('wrote', target);
