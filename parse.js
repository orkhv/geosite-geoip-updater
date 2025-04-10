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

const ipBytesToString = (ipBytes) => {
  if (!ipBytes || typeof ipBytes !== 'object') {
    return '';
  }
  
  // Преобразуем входные данные в массив байтов
  let bytes = [];
  if (ipBytes instanceof Uint8Array) {
    bytes = Array.from(ipBytes);
  } else if (Buffer.isBuffer(ipBytes)) {
    bytes = Array.from(ipBytes);
  } else if (Array.isArray(ipBytes)) {
    bytes = ipBytes;
  } else {
    return '';
  }

  // Проверяем, что у нас есть как минимум 4 байта для IPv4
  if (bytes.length < 4) {
    return '';
  }

  // Берем только первые 4 байта для IPv4 адреса
  return bytes.slice(0, 4).join('.');
};

const formatIPv6 = (bytes) => {
  // Проверяем входные данные
  if (!bytes || bytes.length !== 16) {
    return '';
  }

  // Преобразуем байты в группы по 2 байта (16 бит)
  const parts = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const hex = ((bytes[i] << 8) + bytes[i + 1]).toString(16).padStart(4, '0');
    parts.push(hex);
  }

  // Находим самую длинную последовательность нулей для сжатия
  let maxZeroStart = -1;
  let maxZeroLength = 0;
  let currentZeroStart = -1;
  let currentZeroLength = 0;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '0000') {
      if (currentZeroStart === -1) {
        currentZeroStart = i;
        currentZeroLength = 1;
      } else {
        currentZeroLength++;
      }
    } else {
      if (currentZeroLength > maxZeroLength) {
        maxZeroStart = currentZeroStart;
        maxZeroLength = currentZeroLength;
      }
      currentZeroStart = -1;
      currentZeroLength = 0;
    }
  }

  if (currentZeroLength > maxZeroLength) {
    maxZeroStart = currentZeroStart;
    maxZeroLength = currentZeroLength;
  }

  // Применяем сжатие, если нашли последовательность нулей длиной 2 или более
  if (maxZeroLength >= 2) {
    const before = parts.slice(0, maxZeroStart).join(':');
    const after = parts.slice(maxZeroStart + maxZeroLength).join(':');
    return `${before}::${after}`;
  }

  // Если нет длинных последовательностей нулей, просто соединяем части
  return parts.join(':');
};

const formatIPAddress = (bytes) => {
  if (!bytes || bytes.length === 0) return '';
  
  // Для IPv4 (4 байта)
  if (bytes.length === 4) {
    const octets = Array.from(bytes);
    // Проверяем, что все октеты являются числами
    if (octets.some(octet => typeof octet !== 'number')) {
      console.error('Invalid IPv4 octets:', octets);
      return '';
    }
    return octets.join('.');
  }
  
  // Для IPv6 (16 байт)
  if (bytes.length === 16) {
    return formatIPv6(bytes);
  }
  
  return '';
};

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
1      const result = parsed.entry.map(e => {
        const includes = e.domain.filter(d => d.value.startsWith('include:'));
        if (includes.length > 0) {
          console.log(`Category ${e.countryCode} includes:`, includes.map(d => d.value));
        }
        return {
          category: e.countryCode || 'unknown',
          entries: e.domain.map(d => d.value).filter(value => value.startsWith('include:') || !value.startsWith('include:')),
        };
      });
      console.log(`Parsed ${result.length} geosite entries`);
      return result;
    } else if (type === 'v2ray.geoip.List') {
      const result = parsed.entry.map(e => {
        if (!e.countryCode || typeof e.countryCode !== 'string') {
          console.warn('Пропущена запись с некорректным category:', e);
          return null;
        }
        if (!Array.isArray(e.cidrs) || e.cidrs.some(c => !c.ip || typeof c.prefix !== 'number')) {
          console.warn('Пропущена запись с некорректными entries:', e);
          return null;
        }
        return {
          category: e.countryCode || 'unknown',
          entries: e.cidrs.map(c => {
            try {
              // Получаем байты IP-адреса
              let buffer;
              if (typeof c.ip === 'string') {
                // Если это строка, предполагаем что это бинарные данные
                buffer = Buffer.from(c.ip, 'binary');
              } else if (c.ip instanceof Uint8Array) {
                buffer = Buffer.from(c.ip);
              } else if (Buffer.isBuffer(c.ip)) {
                buffer = c.ip;
              } else {
                console.error('Неизвестный формат IP:', typeof c.ip);
                return null;
              }

              // Пытаемся определить версию IP по длине
              let ipString;
              if (buffer.length === 4) {
                // IPv4
                const octets = Array.from(buffer).map(b => b & 0xFF);
                ipString = octets.join('.');
                
                // Проверяем корректность префикса для IPv4
                if (c.prefix > 32) {
                  console.error('Некорректный префикс IPv4:', c.prefix);
                  return null;
                }
              } else if (buffer.length === 16) {
                // IPv6
                const octets = [];
                for (let i = 0; i < buffer.length; i += 2) {
                  octets.push(((buffer[i] << 8) | buffer[i + 1]).toString(16).padStart(4, '0'));
                }
                
                // Находим самую длинную последовательность нулей для сжатия
                let maxZeroStart = -1;
                let maxZeroLen = 0;
                let curZeroStart = -1;
                let curZeroLen = 0;

                for (let i = 0; i < octets.length; i++) {
                  if (octets[i] === '0000') {
                    if (curZeroStart === -1) {
                      curZeroStart = i;
                      curZeroLen = 1;
                    } else {
                      curZeroLen++;
                    }
                  } else {
                    if (curZeroLen > maxZeroLen) {
                      maxZeroStart = curZeroStart;
                      maxZeroLen = curZeroLen;
                    }
                    curZeroStart = -1;
                    curZeroLen = 0;
                  }
                }

                if (curZeroLen > maxZeroLen) {
                  maxZeroStart = curZeroStart;
                  maxZeroLen = curZeroLen;
                }

                // Форматируем IPv6 адрес
                if (maxZeroLen > 1) {
                  const before = octets.slice(0, maxZeroStart);
                  const after = octets.slice(maxZeroStart + maxZeroLen);
                  ipString = before.join(':') + '::' + after.join(':');
                } else {
                  ipString = octets.join(':');
                }

                // Проверяем корректность префикса для IPv6
                if (c.prefix > 128) {
                  console.error('Некорректный префикс IPv6:', c.prefix);
                  return null;
                }
              } else {
                return null;
              }

              if (buffer.length !== 4 && buffer.length !== 16) {
                return null;
              }

              return `${ipString}/${c.prefix}`;
            } catch (error) {
              console.error('Ошибка обработки CIDR:', error);
              return null;
            }
          }).filter(entry => entry !== null),
        };
      }).filter(entry => entry !== null);
      console.log(`Обработано ${result.length} geoip записей`);
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
