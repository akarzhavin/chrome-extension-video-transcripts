import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS, FONT} from '../theme';

export const Cta = ({durationInFrames}: {durationInFrames: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame, fps, config: {damping: 14, mass: 0.8}});
  const scale = interpolate(enter, [0, 1], [0.7, 1]);
  const glow = 16 + (0.5 + 0.5 * Math.sin(frame / 7)) * 30;

  const lineOpacity = interpolate(frame, [12, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const btnSpring = spring({frame: frame - 20, fps, config: {damping: 12}});
  const btnScale = interpolate(btnSpring, [0, 1], [0.8, 1]);
  const btnOpacity = interpolate(frame, [20, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    {extrapolateLeft: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 26, transform: `scale(${scale})`}}>
        <Img
          src={staticFile('logo.png')}
          style={{
            width: 130,
            height: 130,
            filter: `drop-shadow(0 0 ${glow}px ${COLORS.cyan})`,
          }}
        />
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -2,
            color: COLORS.white,
          }}
        >
          Lingogram
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          fontSize: 32,
          fontWeight: 500,
          color: COLORS.muted,
          opacity: lineOpacity,
        }}
      >
        Dual subtitles &amp; one-click word saving for YouTube
      </div>

      <div
        style={{
          marginTop: 48,
          transform: `scale(${btnScale})`,
          opacity: btnOpacity,
          padding: '22px 50px',
          borderRadius: 999,
          fontSize: 34,
          fontWeight: 800,
          color: COLORS.bg0,
          background: `linear-gradient(135deg, ${COLORS.cyanSoft}, ${COLORS.cyan})`,
          boxShadow: `0 0 50px ${COLORS.cyan}66`,
        }}
      >
        Add to Chrome — Free
      </div>
    </AbsoluteFill>
  );
};
