// parse.js
import fs from 'fs';
import https from 'https';
import protobuf from 'protobufjs';
const { load } = protobuf;

const download = (url, dest) => new Promise((resolve, reject) => {
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
  }).on('error', (err) => reject(err));
});

const parseDat = async (protoFile, datFile, type) => {
  const root = await load(protoFile);
  const Target = root.lookupType(type);
  const buffer = fs.readFileSync(datFile);
  const parsed = Target.decode(buffer);

  if (type === 'v2ray.geosite.List') {
    return parsed.entry.map(e => ({
      category: e.countryCode || 'unknown',
      entries: e.domain.map(d => d.value),
    }));
  } else if (type === 'v2ray.geoip.List') {
    return parsed.entry.map(e => ({
      category: e.countryCode || 'unknown',
      entries: e.cidrs.map(c => c.ip + '/' + c.prefix),
    }));
  }
  return [];
};

const main = async () => {
  await download('https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat', 'geosite.dat');
  await download('https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat', 'geoip.dat');

  const geosite = await parseDat('geosite.proto', 'geosite.dat', 'v2ray.geosite.List');
  const geoip = await parseDat('geoip.proto', 'geoip.dat', 'v2ray.geoip.List');

  fs.writeFileSync('geosite.json', JSON.stringify(geosite, null, 2));
  fs.writeFileSync('geoip.json', JSON.stringify(geoip, null, 2));
};

main();

// geosite.proto
// syntax = "proto3";
// package v2ray.geosite;
// message Domain {
//   enum Type {
//     Plain = 0;
//     Regex = 1;
//     Domain = 2;
//     Full = 3;
//     Keyword = 4;
//   }
//   Type type = 1;
//   string value = 2;
// }
// message Entry {
//   string countryCode = 1;
//   repeated Domain domain = 2;
// }
// message List {
//   repeated Entry entry = 1;
// }

// geoip.proto
// syntax = "proto3";
// package v2ray.geoip;
// message CIDR {
//   string ip = 1;
//   uint32 prefix = 2;
// }
// message Entry {
//   string countryCode = 1;
//   repeated CIDR cidrs = 2;
// }
// message List {
//   repeated Entry entry = 1;
// }
