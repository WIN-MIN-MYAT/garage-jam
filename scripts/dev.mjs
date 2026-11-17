import os from 'node:os';
import qr from 'qrcode-terminal';

const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) => (addresses || [])
  .filter(address => address.family === 'IPv4' && !address.internal)
  .map(address => ({ name, ip: address.address })));
const preferred = interfaces.find(item => /wi-?fi|wireless|ethernet/i.test(item.name) && !/virtual|vEthernet|wsl|docker|hyper-v/i.test(item.name)) || interfaces[0];
const protocol = process.env.GARAGE_HTTP === '1' ? 'http' : 'https';
console.log(`Garage Jam ${protocol.toUpperCase()} URLs:`);
for (const { name, ip } of interfaces) console.log(`  ${name}: ${protocol}://${ip}:8091/  sender: ${protocol}://${ip}:8091/sender`);
if (preferred) qr.generate(`${protocol}://${preferred.ip}:8091/`, { small: true }, code => console.log(`QR for ${preferred.name}:\n${code}`));
