uniform vec3 uRevealOrigin;
uniform float uRevealProgress;
uniform vec3 uRevealDir;
uniform vec2 uRevealRange;
uniform float uRevealMode;
uniform float uRevealEdgeWidth;
uniform vec3 uRevealEdgeColor;
uniform sampler2D uRevealNoise;
uniform sampler2D uRevealDrip;
uniform float uRevealTime;
uniform float uRevealNoiseAmount;
uniform float uRevealDripAmount;
uniform float uRevealUseNoise;
uniform float uRevealUseDrips;
varying vec3 vRevealWorld;

float gjRevealValue(vec3 world) {
  if (uRevealProgress >= 1.049) return 0.0;
  float value = 0.0;
  if (uRevealMode < 0.5) {
    value = distance(world.xz, uRevealOrigin.xz) / max(uRevealRange.y, 0.001);
    float noise = (texture2D(uRevealNoise, world.xz * 0.33 + uRevealTime * 0.01).r - 0.5) * uRevealNoiseAmount * uRevealUseNoise;
    value += noise;
  } else if (uRevealMode < 1.5) {
    value = (world.y - uRevealRange.x) / max(uRevealRange.y - uRevealRange.x, 0.001);
    float along = dot(world.xz - uRevealOrigin.xz, uRevealDir.xz);
    float grain = texture2D(uRevealNoise, vec2(along * 0.38, world.y * 0.31)).r - 0.5;
    float paint = texture2D(uRevealDrip, vec2(along * 0.34, 0.5)).r - 0.32;
    float stroke = smoothstep(0.0, 0.14, uRevealProgress) * (1.0 - smoothstep(0.87, 1.01, uRevealProgress));
    value += stroke * (grain * uRevealNoiseAmount * uRevealUseNoise - paint * uRevealDripAmount * uRevealUseDrips);
  } else {
    value = (dot(world.xz, uRevealDir.xz) - uRevealRange.x) / max(uRevealRange.y - uRevealRange.x, 0.001);
    float noise = (texture2D(uRevealNoise, world.xz * 0.21 + uRevealTime * 0.013).r - 0.5) * uRevealNoiseAmount * uRevealUseNoise;
    value += noise;
  }
  return value;
}
