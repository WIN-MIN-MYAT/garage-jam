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
  float value = 0.0;
  if (uRevealMode < 0.5) {
    value = distance(world.xz, uRevealOrigin.xz) / max(uRevealRange.y, 0.001);
    float noise = (texture2D(uRevealNoise, world.xz * 0.33 + uRevealTime * 0.01).r - 0.5) * uRevealNoiseAmount * uRevealUseNoise;
    value += noise;
  } else if (uRevealMode < 1.5) {
    value = (world.y - uRevealRange.x) / max(uRevealRange.y - uRevealRange.x, 0.001);
    float noise = (texture2D(uRevealNoise, vec2(world.x * 0.37, world.z * 0.37)).r - 0.5) * uRevealNoiseAmount * uRevealUseNoise;
    float drip = texture2D(uRevealDrip, vec2(world.x * 0.42, 0.5)).r;
    value += noise - drip * uRevealDripAmount * uRevealUseDrips;
  } else {
    value = (dot(world.xz, uRevealDir.xz) - uRevealRange.x) / max(uRevealRange.y - uRevealRange.x, 0.001);
    float noise = (texture2D(uRevealNoise, world.xz * 0.21 + uRevealTime * 0.013).r - 0.5) * uRevealNoiseAmount * uRevealUseNoise;
    value += noise;
  }
  return value;
}
