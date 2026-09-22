import http from 'http';
const get = (p) => new Promise((r) =>
  http.get({ host: '127.0.0.1', port: 3000, path: p }, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => r(s));
  }));
const html = await get('/index.html');
const js = await get('/src/app.js');
console.log('html v600a option:', html.includes('value="v600a"'));
console.log('html v600b option:', html.includes('value="v600b"'));
console.log('app.js v600a dataset:', js.includes('v600a: {'));
console.log('app.js generic selector:', js.includes('DATASETS[q] ? q'));
console.log('app.js loadDataset generic:', js.includes("currentDataset = DATASETS[key] ? key : 'v1'"));
