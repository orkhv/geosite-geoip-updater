// parse.js
import fs from 'fs';
import https from 'https';
import { URL } from 'url';
import protobuf from 'protobufjs';
const { load } = protobuf;

const download = (url, dest) => new Promise((resolve, reject) => {
  console.log(`Downloading ${url} to ${dest}`);
  const file = fs.createWriteStream(dest);
  
  const makeRequest = (url) => {
    https.get(url, (res) => {
      console.log(`Response status: ${res.statusCode}`);
      
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        console.log(`Redirecting to: ${redirectUrl}`);
        makeRequest(redirectUrl);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Download completed: ${dest}`);
        resolve();
      });
    }).on('error', (err) => {
      console.error(`Download error: ${err.message}`);
      reject(err);
    });
  };

  makeRequest(url);
});

const parseDat = async (protoFile, datFile, type) => {
  console.log(`Parsing ${datFile} with ${protoFile} as ${type}`);
  try {
    // Проверяем существование файлов
    if (!fs.existsSync(protoFile)) {
      throw new Error(`Proto file not found: ${protoFile}`);
    }
    if (!fs.existsSync(datFile)) {
      throw new Error(`Dat file not found: ${datFile}`);
    }

    const root = await load(protoFile);
    console.log('Proto file loaded successfully');
    const Target = root.lookupType(type);
    console.log('Target type found');
    const buffer = fs.readFileSync(datFile);
    console.log(`Read ${buffer.length} bytes from ${datFile}`);
    const parsed = Target.decode(buffer);
    console.log('Successfully decoded data');

    if (type === 'v2ray.geosite.List') {
      const result = parsed.entry.map(e => ({
        category: e.countryCode || 'unknown',
        entries: e.domain.map(d => d.value),
      }));
      console.log(`Parsed ${result.length} geosite entries`);
      return result;
    } else if (type === 'v2ray.geoip.List') {
      const result = parsed.entry.map(e => ({
        category: e.countryCode || 'unknown',
        entries: e.cidrs.map(c => c.ip + '/' + c.prefix),
      }));
      console.log(`Parsed ${result.length} geoip entries`);
      return result;
    }
    return [];
  } catch (error) {
    console.error(`Error parsing ${datFile}:`, error);
    throw error;
  }
};

const main = async () => {
  try {
    console.log('Starting main process');
    console.log('Current directory:', process.cwd());
    console.log('Directory contents:', fs.readdirSync('.'));
    
    await download('https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat', 'geosite.dat');
    await download('https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat', 'geoip.dat');

    console.log('Files after download:', fs.readdirSync('.'));

    const geosite = await parseDat('geosite.proto', 'geosite.dat', 'v2ray.geosite.List');
    const geoip = await parseDat('geoip.proto', 'geoip.dat', 'v2ray.geoip.List');

    console.log('Writing JSON files');
    fs.writeFileSync('geosite.json', JSON.stringify(geosite, null, 2));
    fs.writeFileSync('geoip.json', JSON.stringify(geoip, null, 2));
    console.log('Process completed successfully');
  } catch (error) {
    console.error('Main process error:', error);
    process.exit(1);
  }
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
