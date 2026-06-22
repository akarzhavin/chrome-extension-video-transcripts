import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {COLORS} from '../theme';

// Deep navy base with two slowly drifting neon glows (cyan + purple).
export const Background = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const gx = 28 + Math.sin(t * 0.45) * 14;
  const gy = 32 + Math.cos(t * 0.38) * 10;

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.bg0}}>
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(55% 55% at ${gx}% ${gy}%, ${COLORS.purple}33, transparent 70%),
            radial-gradient(60% 60% at ${100 - gx}% ${88 - gy * 0.4}%, ${COLORS.cyan}26, transparent 72%),
            linear-gradient(155deg, ${COLORS.bg1}, ${COLORS.bg0})
          `,
        }}
      />
      {/* vignette */}
      <AbsoluteFill
        style={{boxShadow: 'inset 0 0 420px rgba(0,0,0,0.65)'}}
      />
    </AbsoluteFill>
  );
};
