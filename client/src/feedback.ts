/** Small, failure-tolerant controller feedback helper. */

export function pulseGamepads(gamepads: any, intensity = 0.35, duration = 30) {
  for (const side of ['left', 'right'] as const) {
    try {
      const actuator = gamepads?.[side]?.gamepad?.hapticActuators?.[0];
      if (actuator?.pulse) {
        const result = actuator.pulse(intensity, duration);
        result?.catch?.(() => { /* haptics are optional */ });
      } else {
        actuator?.vibrate?.(duration);
      }
    } catch { /* haptics are optional */ }
  }
}
