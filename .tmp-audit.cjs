const fs = require('fs');
const dir = 'docs/references/etymology/batches/';
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const existing = new Set();
fs.readFileSync('docs/references/etymology/existing-words.txt', 'utf8')
  .split(/\r?\n/).forEach(w => { if (w.trim()) existing.add(norm(w)); });
const batchWords = {};
for (const f of ['lux', 'virtue', 'harvest', 'essence']) {
  const arr = JSON.parse(fs.readFileSync(dir + f + '.json', 'utf8'));
  batchWords[f] = new Set(arr.map(e => norm(e.word)));
}
const report = [];
for (const f of ['lux', 'virtue', 'harvest', 'essence']) {
  const arr = JSON.parse(fs.readFileSync(dir + f + '.json', 'utf8'));
  arr.forEach(e => {
    (e.candidates || []).forEach(c => {
      const n = norm(c);
      const hits = [];
      if (existing.has(n)) hits.push('existing-270');
      for (const b in batchWords) if (batchWords[b].has(n)) hits.push(b + ' word');
      if (hits.length) report.push(f + ' :: ' + e.word + ' -> candidate "' + c + '" clashes with: ' + hits.join(', '));
    });
  });
}
console.log(report.length ? report.join('\n') : 'no candidate clashes by normalize comparison');
const ess = JSON.parse(fs.readFileSync(dir + 'essence.json', 'utf8'));
console.log('essence Fern candidates:', JSON.stringify(ess.find(e => e.word === 'Fern').candidates));
