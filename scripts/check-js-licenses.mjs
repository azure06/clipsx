import fs from 'node:fs';
const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
const denied=/(^|\s|\()AGPL|SSPL|BUSL|Commons Clause/i;const missing=[];const rejected=[];
for(const [name,pkg] of Object.entries(lock.packages)){if(!name||name.startsWith('node_modules/@clipsx/'))continue;const license=pkg.license;if(!license)missing.push(name);else if(denied.test(license))rejected.push(`${name}: ${license}`)}
if(missing.length||rejected.length){console.error('Dependency license policy failed.');if(missing.length)console.error(`Missing metadata:\n${missing.join('\n')}`);if(rejected.length)console.error(`Denied:\n${rejected.join('\n')}`);process.exit(1)}
console.log(`Checked ${Object.keys(lock.packages).length-1} JavaScript dependency records.`);
