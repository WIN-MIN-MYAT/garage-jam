type SkyLook = {
  colors: [string, string, string, string];
  mountain: string;
  houses: string;
  windows: string;
  light: number;
  strength: number;
  orbY: number;
};

export const skyLooks = {
  morning: { colors: ['#586d99', '#8b9ec2', '#f4bba3', '#ffdda5'], mountain: '#817990', houses: '#57556c', windows: '#ffd39f', light: 0xffd7aa, strength: 0.82, orbY: 425 },
  noon: { colors: ['#2766a0', '#488cbe', '#83b8d7', '#c8e3e4'], mountain: '#638797', houses: '#4b6171', windows: '#aec7c5', light: 0xf2fbff, strength: 1.05, orbY: 290 },
  golden: { colors: ['#332e50', '#875069', '#e19073', '#eead7d'], mountain: '#89586b', houses: '#564356', windows: '#e3a87f', light: 0xffaf80, strength: 1, orbY: 405 },
  night: { colors: ['#0d1029', '#20274b', '#364069', '#505879'], mountain: '#333b61', houses: '#191f39', windows: '#e5aa75', light: 0xa3bbff, strength: 0.32, orbY: 365 },
} satisfies Record<string, SkyLook>;

export type SkyPeriod = keyof typeof skyLooks;
export type SkyWeather = 'sunny' | 'cloud' | 'rain' | 'snow';

export function paintDriveway(ctx: CanvasRenderingContext2D, period: SkyPeriod, weather: SkyWeather) {
  const night = period === 'night';
  const [far, near, line, curb] = weather === 'snow'
    ? night ? ['#404965', '#65738b', '#95a9c4', '#67758c'] : ['#899caf', '#c2cdd7', '#e7edf2', '#b0beca']
    : weather === 'rain' ? ['#303945', '#4b5869', '#748da6', '#526176']
    : night ? ['#202439', '#30354b', '#515970', '#424a62']
    : period === 'golden' ? ['#564356', '#6b515b', '#907075', '#745963']
    : ['#586171', '#737986', '#a5a1a2', '#848590'];
  const pavement = ctx.createLinearGradient(0, 0, 0, 128);
  pavement.addColorStop(0, far);
  pavement.addColorStop(1, near);
  ctx.fillStyle = pavement;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = line;
  ctx.fillRect(0, 66, 128, 2);
  ctx.fillStyle = curb;
  ctx.fillRect(0, 68, 128, 6);
  if (weather === 'rain') {
    ctx.fillStyle = 'rgba(165,190,214,0.18)';
    for (const [x, y, width] of [[12, 49, 18], [77, 58, 24], [43, 93, 27], [108, 111, 13]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, width, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function paintGarageSky(ctx: CanvasRenderingContext2D, look: SkyLook, weather: SkyWeather) {
  const night = look === skyLooks.night;
  const clouds = weather !== 'sunny';
  const colors = weather === 'rain' ? ['#293444', '#47566f', '#77899c', '#aeb2b9']
    : weather === 'snow' ? ['#596a85', '#879cb4', '#bccbd8', '#e3e9ec']
    : weather === 'cloud' ? ['#555b75', '#7e859d', '#b1aeb5', '#d6c5bb']
    : look.colors;
  const gradient = ctx.createLinearGradient(0, 0, 0, 768);
  [0, 0.4, 0.64, 1].forEach((stop, index) => gradient.addColorStop(stop, colors[index]));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 768);
  if (clouds && night) {
    ctx.fillStyle = 'rgba(9,13,41,0.57)';
    ctx.fillRect(0, 0, 1024, 768);
  }
  if (!clouds) {
    if (night) {
      ctx.fillStyle = '#bacdf2';
      for (let i = 0; i < 60; i++) {
        ctx.globalAlpha = 0.20 + ((i * 49) % 70) / 100;
        ctx.fillRect((i * 127 + 39) % 1024, 90 + (i * 157) % 385, i % 7 ? 2 : 3, i % 7 ? 2 : 3);
      }
      ctx.globalAlpha = 1;
    }
    const glowColor = night ? '173,199,253' : look === skyLooks.noon ? '255,232,185' : '255,209,137';
    const glow = ctx.createRadialGradient(580, look.orbY, 24, 580, look.orbY, 160);
    glow.addColorStop(0, `rgba(${glowColor},${night ? 0.34 : 0.70})`);
    glow.addColorStop(1, `rgba(${glowColor},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(400, look.orbY - 170, 360, 340);
    ctx.fillStyle = night ? '#d8e5ff' : look === skyLooks.noon ? '#fff8db' : '#ffdc9d';
    ctx.beginPath(); ctx.arc(580, look.orbY, night ? 27 : 43, 0, Math.PI * 2); ctx.fill();
  }
  if (clouds || look === skyLooks.noon || look === skyLooks.morning) {
    for (const [x, y, width, height] of [[24, 238, 330, 26], [276, 346, 430, 38], [655, 292, 350, 34], [15, 430, 380, 16]]) {
      ctx.fillStyle = weather === 'rain' ? 'rgba(38,47,69,0.22)' : 'rgba(248,239,238,0.24)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + width * 0.23, y - height, x + width * 0.62, y - height * 0.35, x + width, y - height);
      ctx.bezierCurveTo(x + width * 0.82, y, x + width * 0.48, y + height, x, y);
      ctx.fill();
    }
  }
  ctx.fillStyle = weather === 'snow' ? '#7b8d9e' : weather === 'rain' ? '#525e70' : look.mountain;
  ctx.beginPath(); ctx.moveTo(0, 505);
  ctx.bezierCurveTo(170, 463, 280, 515, 419, 489);
  ctx.bezierCurveTo(594, 516, 743, 443, 1024, 495);
  ctx.lineTo(1024, 768); ctx.lineTo(0, 768); ctx.fill();
  if (night && clouds) ctx.fillStyle = look.houses;
  else ctx.fillStyle = weather === 'snow' ? '#526475' : weather === 'rain' ? '#394350' : look.houses;
  for (const [x, y, width, height] of [[30, 489, 150, 58], [220, 467, 111, 77], [355, 492, 112, 47], [685, 477, 136, 68], [832, 455, 145, 88]]) {
    ctx.beginPath(); ctx.moveTo(x, y + height); ctx.lineTo(x, y + 13);
    ctx.lineTo(x + width * 0.48, y - 9); ctx.lineTo(x + width, y + 13);
    ctx.lineTo(x + width, y + height); ctx.fill();
    if (weather === 'snow') {
      const house: string | CanvasGradient | CanvasPattern = ctx.fillStyle;
      ctx.strokeStyle = night ? '#889cb9' : '#d6e4eb';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x, y + 13); ctx.lineTo(x + width * 0.48, y - 9); ctx.lineTo(x + width, y + 13); ctx.stroke();
      ctx.fillStyle = house;
    }
  }
  ctx.fillRect(0, 535, 1024, 233);
  ctx.fillStyle = look.windows;
  for (const [x, y] of [[140, 520], [251, 502], [276, 502], [728, 516], [756, 516], [884, 495]]) ctx.fillRect(x, y, 10, 5);
}
